"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/auth/permissions";
import { visibleDepartments } from "@/lib/stock/overview";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type UpdateStockItem = {
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  previousQtyG: number;
};

export type UpdateStockData = {
  items: UpdateStockItem[];
  alreadyClosed: boolean;
  closedCountNo: string | null;
};

const submitSchema = z.object({
  departmentId: z.uuid(),
  countDate: z.iso.date(),
  lines: z
    .array(
      z.object({
        itemType: z.enum(["raw", "flavour"]),
        itemId: z.uuid(),
        countedQtyG: z.number().int().min(0, "Closing stock cannot be negative"),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1, "Enter a closing quantity for at least one item"),
});

/**
 * Which locations this user may close stock for. Computed from the session
 * rather than accepted from the client, so the dropdown can only ever
 * offer authorised locations — and the database re-checks anyway (§13,
 * §48).
 */
export async function getUpdatableLocations(): Promise<
  { id: string; name: string; branchName: string; holdsRaw: boolean; holdsMixed: boolean }[]
> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:update")) return [];

  const admin = createAdminClient();
  const departments = await visibleDepartments(session);
  const internalIds = departments.filter((d) => d.type !== "club").map((d) => d.id);
  if (internalIds.length === 0) return [];

  const { data } = await admin
    .from("departments")
    .select("id, name, holds_raw, holds_mixed, branches(name)")
    .in("id", internalIds)
    .order("name");

  return ((data ?? []) as unknown as {
    id: string;
    name: string;
    holds_raw: boolean;
    holds_mixed: boolean;
    branches: { name: string } | null;
  }[]).map((d) => ({
    id: d.id,
    name: d.name,
    branchName: d.branches?.name ?? "",
    holdsRaw: d.holds_raw,
    holdsMixed: d.holds_mixed,
  }));
}

/**
 * The rows for one location's closing sheet: every item it can hold, with
 * what the system currently believes. The user never types a difference —
 * this is the "previous" side of the subtraction (§11).
 */
export async function getUpdateStockData(
  departmentId: string,
  countDate: string,
  itemType: "raw" | "flavour",
): Promise<ActionResult<UpdateStockData>> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:update")) {
    return { success: false, error: "You cannot update stock." };
  }

  const allowed = await getUpdatableLocations();
  if (!allowed.some((l) => l.id === departmentId)) {
    return {
      success: false,
      error: "You are not authorised to update stock for this location.",
    };
  }

  const admin = createAdminClient();

  const [{ data: existing }, { data: balances }, masters] = await Promise.all([
    admin
      .from("stock_counts")
      .select("count_no")
      .eq("department_id", departmentId)
      .eq("count_date", countDate)
      .eq("kind", "daily_close")
      .maybeSingle(),
    admin
      .from("stock_balances")
      .select("item_type, item_id, qty_g")
      .eq("department_id", departmentId),
    itemType === "flavour"
      ? admin.from("flavours").select("id, name, code").eq("is_active", true).order("name")
      : admin.from("raw_materials").select("id, name, code").eq("is_active", true).order("name"),
  ]);

  const qtyByKey = new Map(
    (balances ?? []).map((b) => [`${b.item_type}|${b.item_id}`, b.qty_g]),
  );

  const items: UpdateStockItem[] = (masters.data ?? []).map((m) => ({
    itemType,
    itemId: m.id,
    name: m.name,
    code: m.code,
    previousQtyG: qtyByKey.get(`${itemType}|${m.id}`) ?? 0,
  }));

  return {
    success: true,
    data: {
      items,
      alreadyClosed: Boolean(existing),
      closedCountNo: existing?.count_no ?? null,
    },
  };
}

/**
 * Saves the day's closing figures. The database function snapshots what it
 * believed, records every line and posts only the differences, all in one
 * transaction — so a half-saved day is impossible (§66).
 */
export async function submitDailyClose(
  input: z.input<typeof submitSchema>,
): Promise<ActionResult<{ countId: string }>> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:update")) {
    return { success: false, error: "You cannot update stock." };
  }

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Check the quantities entered.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_daily_close", {
    p_department_id: parsed.data.departmentId,
    p_count_date: parsed.data.countDate,
    p_lines: parsed.data.lines.map((l) => ({
      item_type: l.itemType,
      item_id: l.itemId,
      counted_qty_g: l.countedQtyG,
      note: l.note ?? null,
    })),
  });

  if (error) {
    // Postgres raises these as readable sentences already; anything else
    // is not shown to the user raw (§65).
    const known = [
      "already been closed",
      "not authorised",
      "cannot be negative",
      "future date",
      "Location not found",
      "cannot record a daily closing count",
    ];
    const message = known.some((k) => error.message.includes(k))
      ? error.message
      : "Could not save the stock update. Please try again.";
    return { success: false, error: message };
  }

  revalidatePath("/stock");
  revalidatePath("/stock/update");
  return { success: true, data: { countId: data as string } };
}
