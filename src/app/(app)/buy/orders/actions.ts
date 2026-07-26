"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createDraftOrders,
  godownsByBranch,
} from "@/app/(app)/buy/actions";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

async function requireBuyAccess() {
  const session = await getSession();
  if (!session || !can(session.role, "nav:buy")) return null;
  return session;
}

export type OrderFilters = {
  supplierId?: string;
  status?: string;
  branchId?: string;
  from?: string;
  to?: string;
};

type OrderRow = {
  id: string;
  poNo: string;
  supplierName: string;
  shipToName: string;
  branchName: string;
  status: string;
  createdAt: string;
  lineCount: number;
  totalQtyG: number;
};

export async function getOrderFilterOptions(): Promise<
  ActionResult<{
    suppliers: { id: string; name: string }[];
    branches: { id: string; name: string }[];
  }>
> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let branchesQuery = admin.from("branches").select("id, name");
  if (session.role !== "admin" && session.branchId) {
    branchesQuery = branchesQuery.eq("id", session.branchId);
  }

  const [{ data: suppliers }, { data: branches }] = await Promise.all([
    admin.from("suppliers").select("id, name").order("name"),
    branchesQuery.order("name"),
  ]);

  return {
    success: true,
    data: { suppliers: suppliers ?? [], branches: branches ?? [] },
  };
}

export async function getOrders(
  filters: OrderFilters,
): Promise<ActionResult<OrderRow[]>> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let query = admin
    .from("purchase_orders")
    .select(
      "id, po_no, status, created_at, suppliers(name), departments(name), branches(name), branch_id, supplier_id, po_lines(qty_g)",
    );

  if (session.role === "admin") {
    if (filters.branchId) query = query.eq("branch_id", filters.branchId);
  } else {
    query = query.eq("branch_id", session.branchId ?? "");
  }
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return { success: false, error: error.message };

  type Row = {
    id: string;
    po_no: string;
    status: string;
    created_at: string;
    suppliers: { name: string } | null;
    departments: { name: string } | null;
    branches: { name: string } | null;
    po_lines: { qty_g: number }[];
  };

  return {
    success: true,
    data: (data as unknown as Row[]).map((r) => ({
      id: r.id,
      poNo: r.po_no,
      supplierName: r.suppliers?.name ?? "Unknown supplier",
      shipToName: r.departments?.name ?? "Unknown department",
      branchName: r.branches?.name ?? "",
      status: r.status,
      createdAt: r.created_at,
      lineCount: r.po_lines.length,
      totalQtyG: r.po_lines.reduce((sum, l) => sum + l.qty_g, 0),
    })),
  };
}

export type RawMaterialWithRate = {
  id: string;
  code: string | null;
  name: string;
  lastRate: number | null;
};

export async function getRawMaterialsWithLastRate(): Promise<
  ActionResult<RawMaterialWithRate[]>
> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  const [{ data: rawMaterials }, { data: rates }] = await Promise.all([
    admin
      .from("raw_materials")
      .select("id, code, name")
      .eq("is_active", true)
      .order("name"),
    admin
      .from("supplier_rates")
      .select("raw_material_id, rate, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const lastRateByMaterial = new Map<string, number>();
  for (const r of rates ?? []) {
    if (!lastRateByMaterial.has(r.raw_material_id)) {
      lastRateByMaterial.set(r.raw_material_id, Number(r.rate));
    }
  }

  return {
    success: true,
    data: (rawMaterials ?? []).map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      lastRate: lastRateByMaterial.get(m.id) ?? null,
    })),
  };
}

const manualOrderSchema = z.object({
  branchId: z.uuid(),
  supplierId: z.uuid(),
  lines: z
    .array(
      z.object({
        rawMaterialId: z.uuid(),
        qtyG: z.coerce.number().int().positive(),
        rate: z.coerce.number().nonnegative().nullable().optional(),
      }),
    )
    .min(1),
});

export async function createManualOrder(
  input: z.infer<typeof manualOrderSchema>,
): Promise<ActionResult<{ id: string; poNo: string }>> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };
  if (!can(session.role, "purchase:manage")) {
    return { success: false, error: "You can't create purchase orders." };
  }

  const parsed = manualOrderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid order." };

  if (session.role !== "admin" && parsed.data.branchId !== session.branchId) {
    return { success: false, error: "Access required." };
  }

  const admin = createAdminClient();
  const godowns = await godownsByBranch(admin, [parsed.data.branchId]);
  const godown = godowns.get(parsed.data.branchId);
  if (!godown) {
    return {
      success: false,
      error: "That branch has no active godown department to ship to.",
    };
  }

  const result = await createDraftOrders([
    {
      supplierId: parsed.data.supplierId,
      departmentId: godown.id,
      lines: parsed.data.lines,
    },
  ]);
  if (!result.success) return result;
  return { success: true, data: result.data[0] };
}
