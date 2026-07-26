"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

async function requireBuyAccess() {
  const session = await getSession();
  if (!session || !can(session.role, "nav:buy")) return null;
  return session;
}

type PoLine = {
  id: string;
  rawMaterialId: string;
  rawMaterialName: string;
  rawMaterialCode: string | null;
  qtyG: number;
  rate: number | null;
};

type PoDetail = {
  id: string;
  poNo: string;
  status: string;
  branchName: string;
  createdAt: string;
  sentAt: string | null;
  notes: string | null;
  supplier: {
    name: string;
    area: string | null;
    contactPerson: string | null;
    phone: string | null;
    gstin: string | null;
  };
  shipTo: { departmentName: string; branchName: string };
  lines: PoLine[];
};

async function loadDetail(poId: string): Promise<PoDetail | null> {
  const admin = createAdminClient();
  const { data: po } = await admin
    .from("purchase_orders")
    .select(
      "id, po_no, status, branch_id, created_at, sent_at, notes, branches(name), suppliers(name, area, contact_person, phone, gstin), departments(name, branches(name))",
    )
    .eq("id", poId)
    .single();
  if (!po) return null;

  const { data: lines } = await admin
    .from("po_lines")
    .select("id, raw_material_id, qty_g, rate, raw_materials(name, code)")
    .eq("purchase_order_id", poId)
    .order("created_at", { ascending: true });

  const branch = po.branches as unknown as { name: string } | null;
  const supplier = po.suppliers as unknown as {
    name: string;
    area: string | null;
    contact_person: string | null;
    phone: string | null;
    gstin: string | null;
  } | null;
  const shipToDept = po.departments as unknown as {
    name: string;
    branches: { name: string } | null;
  } | null;

  return {
    id: po.id,
    poNo: po.po_no,
    status: po.status,
    branchName: branch?.name ?? "",
    createdAt: po.created_at,
    sentAt: po.sent_at,
    notes: po.notes,
    supplier: {
      name: supplier?.name ?? "Unknown supplier",
      area: supplier?.area ?? null,
      contactPerson: supplier?.contact_person ?? null,
      phone: supplier?.phone ?? null,
      gstin: supplier?.gstin ?? null,
    },
    shipTo: {
      departmentName: shipToDept?.name ?? "Unknown department",
      branchName: shipToDept?.branches?.name ?? "",
    },
    lines: (lines ?? []).map((l) => ({
      id: l.id,
      rawMaterialId: l.raw_material_id,
      rawMaterialName:
        (l.raw_materials as unknown as { name: string; code: string | null })
          ?.name ?? "Unknown",
      rawMaterialCode:
        (l.raw_materials as unknown as { name: string; code: string | null })
          ?.code ?? null,
      qtyG: l.qty_g,
      rate: l.rate == null ? null : Number(l.rate),
    })),
  };
}

async function checkBranchAccess(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  branchId: string,
): Promise<boolean> {
  return session.role === "admin" || branchId === session.branchId;
}

export async function getPoDetail(
  poId: string,
): Promise<ActionResult<PoDetail>> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(poId);
  if (!parsed.success) return { success: false, error: "Invalid order." };

  const admin = createAdminClient();
  const { data: po } = await admin
    .from("purchase_orders")
    .select("branch_id")
    .eq("id", parsed.data)
    .single();
  if (!po) return { success: false, error: "Order not found." };
  if (!(await checkBranchAccess(session, po.branch_id))) {
    return { success: false, error: "Access required." };
  }

  const detail = await loadDetail(parsed.data);
  if (!detail) return { success: false, error: "Order not found." };
  return { success: true, data: detail };
}

export async function updatePoLineRate(
  lineId: string,
  rate: number | null,
): Promise<ActionResult<null>> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };
  if (!can(session.role, "purchase:manage")) {
    return { success: false, error: "You can't edit this order." };
  }

  const parsedId = z.uuid().safeParse(lineId);
  if (!parsedId.success) return { success: false, error: "Invalid line." };
  const parsedRate = z.coerce.number().nonnegative().nullable().safeParse(rate);
  if (!parsedRate.success) return { success: false, error: "Invalid rate." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_lines")
    .update({ rate: parsedRate.data })
    .eq("id", parsedId.data);
  if (error) return { success: false, error: error.message };

  return { success: true, data: null };
}

export async function updatePoLineQty(
  lineId: string,
  qtyG: number,
): Promise<ActionResult<null>> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };
  if (!can(session.role, "purchase:manage")) {
    return { success: false, error: "You can't edit this order." };
  }

  const parsedId = z.uuid().safeParse(lineId);
  if (!parsedId.success) return { success: false, error: "Invalid line." };
  const parsedQty = z.coerce.number().int().positive().safeParse(qtyG);
  if (!parsedQty.success) return { success: false, error: "Invalid quantity." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("po_lines")
    .update({ qty_g: parsedQty.data })
    .eq("id", parsedId.data);
  if (error) {
    return {
      success: false,
      error: error.message.includes("locked")
        ? "Quantity is locked once the order has been sent."
        : error.message,
    };
  }

  return { success: true, data: null };
}

export async function sendOrder(poId: string): Promise<ActionResult<null>> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };
  if (!can(session.role, "purchase:manage")) {
    return { success: false, error: "You can't send this order." };
  }

  const parsed = z.uuid().safeParse(poId);
  if (!parsed.success) return { success: false, error: "Invalid order." };

  const admin = createAdminClient();
  const { data: po } = await admin
    .from("purchase_orders")
    .select("branch_id, status")
    .eq("id", parsed.data)
    .single();
  if (!po) return { success: false, error: "Order not found." };
  if (!(await checkBranchAccess(session, po.branch_id))) {
    return { success: false, error: "Access required." };
  }
  if (po.status !== "draft") {
    return { success: false, error: "Only a draft order can be sent." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", parsed.data);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/buy/orders/${parsed.data}`);
  revalidatePath("/buy/orders");
  return { success: true, data: null };
}
