"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

async function requireHodAccess() {
  const session = await getSession();
  if (!session || !["admin", "hod"].includes(session.role)) return null;
  return session;
}

type RequisitionSummary = {
  id: string;
  reqNo: string;
  status: string;
  neededBy: string;
  lineCount: number;
  createdAt: string;
};

export async function getMyRequisitions(): Promise<
  ActionResult<RequisitionSummary[]>
> {
  const session = await requireHodAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("requisitions")
    .select("id, req_no, status, needed_by, created_at, requisition_lines(id)")
    .eq("raised_by", session.userId)
    .order("created_at", { ascending: false });
  if (error) return { success: false, error: error.message };

  return {
    success: true,
    data: (data ?? []).map((r) => ({
      id: r.id,
      reqNo: r.req_no,
      status: r.status,
      neededBy: r.needed_by,
      lineCount: (r.requisition_lines as unknown as { id: string }[]).length,
      createdAt: r.created_at,
    })),
  };
}

type AvailableItem = {
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  currentStockG: number;
};

export async function getAvailableItems(
  departmentId: string,
): Promise<ActionResult<AvailableItem[]>> {
  const session = await requireHodAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(departmentId);
  if (!parsed.success) return { success: false, error: "Invalid department." };
  if (
    session.role !== "admin" &&
    !session.departments.some((d) => d.id === parsed.data)
  ) {
    return { success: false, error: "Access required." };
  }

  const admin = createAdminClient();
  const { data: department } = await admin
    .from("departments")
    .select("holds_raw, holds_mixed")
    .eq("id", parsed.data)
    .single();
  if (!department) return { success: false, error: "Department not found." };

  const [{ data: rawMaterials }, { data: flavours }, { data: balances }] =
    await Promise.all([
      department.holds_raw
        ? admin
            .from("raw_materials")
            .select("id, code, name")
            .eq("is_active", true)
        : Promise.resolve({ data: [] }),
      department.holds_mixed
        ? admin.from("flavours").select("id, code, name").eq("is_active", true)
        : Promise.resolve({ data: [] }),
      admin
        .from("stock_balances")
        .select("item_type, item_id, qty_g")
        .eq("department_id", parsed.data),
    ]);

  const balanceByKey = new Map(
    (balances ?? []).map((b) => [`${b.item_type}|${b.item_id}`, b.qty_g]),
  );

  const items: AvailableItem[] = [
    ...(rawMaterials ?? []).map((m) => ({
      itemType: "raw" as const,
      itemId: m.id,
      name: m.name,
      code: m.code,
      currentStockG: balanceByKey.get(`raw|${m.id}`) ?? 0,
    })),
    ...(flavours ?? []).map((f) => ({
      itemType: "flavour" as const,
      itemId: f.id,
      name: f.name,
      code: f.code,
      currentStockG: balanceByKey.get(`flavour|${f.id}`) ?? 0,
    })),
  ];

  return { success: true, data: items };
}

const lineSchema = z.object({
  itemType: z.enum(["raw", "flavour"]),
  itemId: z.uuid(),
  qtyG: z.coerce.number().int().positive(),
});

const createSchema = z.object({
  departmentId: z.uuid(),
  neededBy: z.string(),
  lines: z.array(lineSchema).min(1, "Add at least one item"),
});

export async function createRequisition(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ requisitionId: string }>> {
  const session = await requireHodAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { departmentId, neededBy, lines } = parsed.data;

  if (
    session.role !== "admin" &&
    !session.departments.some((d) => d.id === departmentId)
  ) {
    return { success: false, error: "Access required." };
  }

  const admin = createAdminClient();
  const { data: department } = await admin
    .from("departments")
    .select("branch_id")
    .eq("id", departmentId)
    .single();
  if (!department) return { success: false, error: "Department not found." };

  const supabase = await createClient();

  const { data: reqNoRow, error: reqNoError } = await supabase.rpc(
    "next_doc_no",
    { p_doc_type: "REQ", p_branch_id: department.branch_id },
  );
  if (reqNoError || !reqNoRow) {
    return {
      success: false,
      error: reqNoError?.message ?? "Could not generate requisition number.",
    };
  }

  const { data: requisition, error: reqError } = await supabase
    .from("requisitions")
    .insert({
      req_no: reqNoRow,
      branch_id: department.branch_id,
      department_id: departmentId,
      raised_by: session.userId,
      needed_by: neededBy,
    })
    .select("id")
    .single();
  if (reqError || !requisition) {
    return {
      success: false,
      error: reqError?.message ?? "Could not create requisition.",
    };
  }

  const { error: linesError } = await supabase.from("requisition_lines").insert(
    lines.map((l) => ({
      requisition_id: requisition.id,
      item_type: l.itemType,
      item_id: l.itemId,
      qty_g: l.qtyG,
    })),
  );
  if (linesError) return { success: false, error: linesError.message };

  revalidatePath("/requisitions");
  return { success: true, data: { requisitionId: requisition.id } };
}

type RequisitionDetail = {
  id: string;
  reqNo: string;
  status: string;
  neededBy: string;
  note: string | null;
  departmentId: string;
  lines: {
    id: string;
    itemType: "raw" | "flavour";
    itemId: string;
    name: string;
    code: string | null;
    qtyG: number;
    decision: string | null;
    approvedQtyG: number | null;
    decisionNote: string | null;
  }[];
};

export async function getRequisitionDetail(
  requisitionId: string,
): Promise<ActionResult<RequisitionDetail>> {
  const session = await requireHodAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(requisitionId);
  if (!parsed.success) return { success: false, error: "Invalid requisition." };

  const admin = createAdminClient();
  const { data: requisition } = await admin
    .from("requisitions")
    .select("id, req_no, status, needed_by, note, raised_by, department_id")
    .eq("id", parsed.data)
    .single();
  if (!requisition) return { success: false, error: "Requisition not found." };
  if (session.role !== "admin" && requisition.raised_by !== session.userId) {
    return { success: false, error: "Access required." };
  }

  const { data: lines } = await admin
    .from("requisition_lines")
    .select(
      "id, item_type, item_id, qty_g, decision, approved_qty_g, decision_note",
    )
    .eq("requisition_id", parsed.data)
    .order("created_at", { ascending: true });

  const rawIds = (lines ?? [])
    .filter((l) => l.item_type === "raw")
    .map((l) => l.item_id);
  const flavourIds = (lines ?? [])
    .filter((l) => l.item_type === "flavour")
    .map((l) => l.item_id);
  const [{ data: rawMaterials }, { data: flavours }] = await Promise.all([
    rawIds.length > 0
      ? admin.from("raw_materials").select("id, code, name").in("id", rawIds)
      : Promise.resolve({ data: [] }),
    flavourIds.length > 0
      ? admin.from("flavours").select("id, code, name").in("id", flavourIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map(
    [...(rawMaterials ?? []), ...(flavours ?? [])].map((m) => [
      m.id,
      { name: m.name, code: m.code },
    ]),
  );

  return {
    success: true,
    data: {
      id: requisition.id,
      reqNo: requisition.req_no,
      status: requisition.status,
      neededBy: requisition.needed_by,
      note: requisition.note,
      departmentId: requisition.department_id,
      lines: (lines ?? []).map((l) => ({
        id: l.id,
        itemType: l.item_type,
        itemId: l.item_id,
        name: nameById.get(l.item_id)?.name ?? "Unknown item",
        code: nameById.get(l.item_id)?.code ?? null,
        qtyG: l.qty_g,
        decision: l.decision,
        approvedQtyG: l.approved_qty_g,
        decisionNote: l.decision_note,
      })),
    },
  };
}

export async function updateRequisitionLineQty(
  lineId: string,
  qtyG: number,
): Promise<ActionResult<null>> {
  const session = await requireHodAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsedId = z.uuid().safeParse(lineId);
  if (!parsedId.success) return { success: false, error: "Invalid line." };
  const parsedQty = z.coerce.number().int().positive().safeParse(qtyG);
  if (!parsedQty.success) return { success: false, error: "Invalid quantity." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("requisition_lines")
    .update({ qty_g: parsedQty.data })
    .eq("id", parsedId.data);
  if (error) return { success: false, error: error.message };

  return { success: true, data: null };
}

export async function addRequisitionLine(
  requisitionId: string,
  itemType: "raw" | "flavour",
  itemId: string,
  qtyG: number,
): Promise<ActionResult<null>> {
  const session = await requireHodAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = lineSchema.safeParse({ itemType, itemId, qtyG });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("requisition_lines").insert({
    requisition_id: requisitionId,
    item_type: parsed.data.itemType,
    item_id: parsed.data.itemId,
    qty_g: parsed.data.qtyG,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/requisitions");
  return { success: true, data: null };
}

export async function submitRequisition(
  requisitionId: string,
): Promise<ActionResult<null>> {
  const session = await requireHodAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(requisitionId);
  if (!parsed.success) return { success: false, error: "Invalid requisition." };

  const admin = createAdminClient();
  const { data: lines } = await admin
    .from("requisition_lines")
    .select("id")
    .eq("requisition_id", parsed.data);
  if (!lines || lines.length === 0) {
    return {
      success: false,
      error: "Add at least one item before submitting.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requisitions")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", parsed.data);
  if (error) return { success: false, error: error.message };

  revalidatePath("/requisitions");
  return { success: true, data: null };
}
