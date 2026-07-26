"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { postMovement } from "@/lib/stock/post-movement";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

async function requireOpeningAccess() {
  const session = await getSession();
  if (!session || !["admin", "store_manager"].includes(session.role)) {
    return null;
  }
  return session;
}

type OpeningData = {
  isLocked: boolean;
  balances: { itemType: "raw" | "flavour"; itemId: string; qtyG: number }[];
};

// "Locked" is derived from the ledger, not a separate flag — a department
// is opened the moment it has any reason='opening' movement at all. This
// matches rule 2 (nothing but stock_movements is the source of truth) and
// means there's nothing to keep in sync if a movement is ever posted
// outside this screen.
export async function getDepartmentOpeningData(
  departmentId: string,
): Promise<ActionResult<OpeningData>> {
  const session = await requireOpeningAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(departmentId);
  if (!parsed.success) return { success: false, error: "Invalid department." };

  const admin = createAdminClient();

  const [
    { data: openingMovements, error: movementsError },
    { data: balances, error: balancesError },
  ] = await Promise.all([
    admin
      .from("stock_movements")
      .select("id")
      .eq("department_id", parsed.data)
      .eq("reason", "opening")
      .limit(1),
    admin
      .from("stock_balances")
      .select("item_type, item_id, qty_g")
      .eq("department_id", parsed.data),
  ]);
  if (movementsError) return { success: false, error: movementsError.message };
  if (balancesError) return { success: false, error: balancesError.message };

  return {
    success: true,
    data: {
      isLocked: (openingMovements ?? []).length > 0,
      balances: (balances ?? []).map((b) => ({
        itemType: b.item_type,
        itemId: b.item_id,
        qtyG: b.qty_g,
      })),
    },
  };
}

const entrySchema = z.object({
  itemType: z.enum(["raw", "flavour"]),
  itemId: z.uuid(),
  desiredQtyG: z.coerce.number().int().min(0),
});

const submitSchema = z.object({
  departmentId: z.uuid(),
  entries: z.array(entrySchema),
  reopen: z.boolean().default(false),
});

// Every entry is expressed as a delta against the department's current
// balance, not an absolute value — stock_movements is append-only, so the
// only way to correct an already-opened department (the reopen path) is to
// post another movement that closes the gap, never to edit or replace the
// original one.
export async function submitOpeningStock(
  input: z.infer<typeof submitSchema>,
): Promise<ActionResult<{ postedCount: number }>> {
  const session = await requireOpeningAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { departmentId, entries, reopen } = parsed.data;

  const openingData = await getDepartmentOpeningData(departmentId);
  if (!openingData.success) return openingData;

  if (openingData.data.isLocked) {
    if (!reopen) {
      return {
        success: false,
        error: "Opening stock has already been submitted for this department.",
      };
    }
    if (session.role !== "admin") {
      return {
        success: false,
        error: "Only admin can reopen an already-submitted department.",
      };
    }
  }

  const supabase = await createClient();

  if (reopen) {
    const { error: logError } = await supabase.rpc("log_audit_event", {
      p_action: "opening_stock_reopened",
      p_entity_type: "department",
      p_entity_id: departmentId,
      p_metadata: {},
    });
    if (logError) {
      console.error("Failed to log opening_stock_reopened:", logError.message);
    }
  }

  const currentByKey = new Map(
    openingData.data.balances.map((b) => [`${b.itemType}|${b.itemId}`, b.qtyG]),
  );

  let postedCount = 0;
  for (const entry of entries) {
    const currentQtyG =
      currentByKey.get(`${entry.itemType}|${entry.itemId}`) ?? 0;
    const deltaG = entry.desiredQtyG - currentQtyG;
    if (deltaG === 0) continue;

    const result = await postMovement(supabase, {
      departmentId,
      itemType: entry.itemType,
      itemId: entry.itemId,
      qtyG: deltaG,
      reason: "opening",
      refType: "department",
      refId: departmentId,
    });
    if (!result.success) {
      return {
        success: false,
        error: `Posted ${postedCount} of ${entries.length} entries, then failed: ${result.error}`,
      };
    }
    postedCount += 1;
  }

  revalidatePath("/stock/opening");
  revalidatePath("/stock");
  return { success: true, data: { postedCount } };
}
