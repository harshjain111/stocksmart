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

export type PartyLineView = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  takenG: number;
  returnedG: number;
  /** Always derived, never stored or entered (§23). */
  consumedG: number;
};

export type PartyView = {
  id: string;
  partyNo: string;
  partyName: string;
  departmentId: string;
  locationName: string;
  eventDate: string;
  expectedReturnDate: string | null;
  status: "out" | "partially_returned" | "completed" | "cancelled";
  /** True when it is past the agreed return date and stock is still out (§22). */
  returnPending: boolean;
  notes: string | null;
  lines: PartyLineView[];
};

export type PartyLocation = { id: string; name: string; branchName: string };

export type AvailableItem = {
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  availableG: number;
};

async function partyDepartments(): Promise<PartyLocation[]> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:party")) return [];

  const admin = createAdminClient();
  const departments = await visibleDepartments(session);
  // Parties are an office movement — the godown supplies offices by
  // transfer, it does not send stock to a wedding (§19).
  const ids = departments
    .filter((d) => d.type === "office" || d.type === "cafe")
    .map((d) => d.id);
  if (ids.length === 0) return [];

  const { data } = await admin
    .from("departments")
    .select("id, name, branches(name)")
    .in("id", ids)
    .order("name");

  return ((data ?? []) as unknown as {
    id: string;
    name: string;
    branches: { name: string } | null;
  }[]).map((d) => ({
    id: d.id,
    name: d.name,
    branchName: d.branches?.name ?? "",
  }));
}

export async function getPartyLocations(): Promise<PartyLocation[]> {
  return partyDepartments();
}

/** What is actually on the shelf at that office, so nobody can send out what isn't there. */
export async function getAvailableItems(
  departmentId: string,
): Promise<ActionResult<AvailableItem[]>> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:party")) {
    return { success: false, error: "You cannot issue party stock." };
  }
  const allowed = await partyDepartments();
  if (!allowed.some((l) => l.id === departmentId)) {
    return { success: false, error: "You are not authorised for this location." };
  }

  const admin = createAdminClient();
  const [{ data: balances }, { data: flavours }] = await Promise.all([
    admin
      .from("stock_balances")
      .select("item_type, item_id, qty_g")
      .eq("department_id", departmentId)
      .gt("qty_g", 0),
    admin.from("flavours").select("id, name, code").eq("is_active", true),
  ]);

  const meta = new Map((flavours ?? []).map((f) => [f.id, f]));
  return {
    success: true,
    data: (balances ?? [])
      .filter((b) => b.item_type === "flavour" && meta.has(b.item_id))
      .map((b) => ({
        itemType: "flavour" as const,
        itemId: b.item_id,
        name: meta.get(b.item_id)!.name,
        code: meta.get(b.item_id)!.code,
        availableG: b.qty_g,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getParties(): Promise<PartyView[]> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:party")) return [];

  const admin = createAdminClient();
  const locations = await partyDepartments();
  const ids = locations.map((l) => l.id);
  if (ids.length === 0) return [];

  const { data: parties } = await admin
    .from("parties")
    .select(
      "id, party_no, party_name, department_id, event_date, expected_return_date, status, notes",
    )
    .in("department_id", ids)
    .order("event_date", { ascending: false })
    .limit(100);

  const partyIds = (parties ?? []).map((p) => p.id);
  if (partyIds.length === 0) return [];

  const [{ data: lines }, { data: flavours }] = await Promise.all([
    admin
      .from("party_lines")
      .select("id, party_id, item_type, item_id, taken_qty_g, returned_qty_g")
      .in("party_id", partyIds),
    admin.from("flavours").select("id, name, code"),
  ]);

  const meta = new Map((flavours ?? []).map((f) => [f.id, f]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const linesByParty = new Map<string, PartyLineView[]>();
  for (const l of lines ?? []) {
    const list = linesByParty.get(l.party_id) ?? [];
    list.push({
      id: l.id,
      itemType: l.item_type,
      itemId: l.item_id,
      name: meta.get(l.item_id)?.name ?? "Unknown flavour",
      code: meta.get(l.item_id)?.code ?? null,
      takenG: l.taken_qty_g,
      returnedG: l.returned_qty_g,
      consumedG: l.taken_qty_g - l.returned_qty_g,
    });
    linesByParty.set(l.party_id, list);
  }

  const today = new Date().toISOString().slice(0, 10);
  return (parties ?? []).map((p) => ({
    id: p.id,
    partyNo: p.party_no,
    partyName: p.party_name,
    departmentId: p.department_id,
    locationName: locationName.get(p.department_id) ?? "",
    eventDate: p.event_date,
    expectedReturnDate: p.expected_return_date,
    status: p.status,
    returnPending:
      p.status !== "completed" &&
      p.status !== "cancelled" &&
      Boolean(p.expected_return_date) &&
      p.expected_return_date < today,
    notes: p.notes,
    lines: (linesByParty.get(p.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  }));
}

const issueSchema = z.object({
  departmentId: z.uuid(),
  partyName: z.string().trim().min(1, "Party name is required").max(160),
  eventDate: z.iso.date(),
  expectedReturnDate: z.iso.date().nullable().optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        itemType: z.enum(["raw", "flavour"]),
        itemId: z.uuid(),
        qtyG: z.number().int().positive("Quantity must be more than zero"),
      }),
    )
    .min(1, "Add at least one flavour"),
});

export async function createPartyEntry(
  input: z.input<typeof issueSchema>,
): Promise<ActionResult<{ partyId: string }>> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:party")) {
    return { success: false, error: "You cannot issue party stock." };
  }

  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Check the entry and try again.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_party_stock", {
    p_department_id: parsed.data.departmentId,
    p_party_name: parsed.data.partyName,
    p_event_date: parsed.data.eventDate,
    p_expected_return_date: parsed.data.expectedReturnDate ?? null,
    p_lines: parsed.data.lines.map((l) => ({
      item_type: l.itemType,
      item_id: l.itemId,
      qty_g: l.qtyG,
    })),
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    // The balance guard inside post_movement speaks in ids; the person at
    // the gate needs the plain version (§65).
    if (error.message.includes("balance negative")) {
      return {
        success: false,
        error: "That is more than this office currently has in stock.",
      };
    }
    const known = ["not authorised", "at least one flavour", "greater than zero", "Location not found"];
    return {
      success: false,
      error: known.some((k) => error.message.includes(k))
        ? error.message
        : "Could not save the party entry. Please try again.",
    };
  }

  revalidatePath("/stock/party");
  revalidatePath("/stock");
  return { success: true, data: { partyId: data as string } };
}

const returnSchema = z.object({
  partyId: z.uuid(),
  close: z.boolean().optional(),
  lines: z.array(
    z.object({
      lineId: z.uuid(),
      returnedQtyG: z.number().int().min(0, "Returned quantity cannot be negative"),
    }),
  ),
});

export async function recordPartyReturn(
  input: z.input<typeof returnSchema>,
): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:party")) {
    return { success: false, error: "You cannot record party returns." };
  }

  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Check the quantities entered.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_party_return", {
    p_party_id: parsed.data.partyId,
    p_lines: parsed.data.lines.map((l) => ({
      line_id: l.lineId,
      returned_qty_g: l.returnedQtyG,
    })),
    p_close: parsed.data.close ?? false,
  });

  if (error) {
    const known = [
      "return more than went out",
      "already closed",
      "not authorised",
      "cannot be negative",
      "Party line not found",
    ];
    return {
      success: false,
      error: known.some((k) => error.message.includes(k))
        ? error.message
        : "Could not save the return. Please try again.",
    };
  }

  revalidatePath("/stock/party");
  revalidatePath("/stock");
  return { success: true, data: null };
}
