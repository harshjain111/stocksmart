"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

const APPROVER_ROLES = ["admin", "branch_manager", "store_manager"] as const;

async function requireApproverAccess() {
  const session = await getSession();
  if (
    !session ||
    !APPROVER_ROLES.includes(session.role as (typeof APPROVER_ROLES)[number])
  ) {
    return null;
  }
  return session;
}

type ToApproveSummary = {
  id: string;
  reqNo: string;
  departmentName: string;
  branchName: string;
  neededBy: string;
  lineCount: number;
  decidedCount: number;
  createdAt: string;
};

export async function getRequisitionsToApprove(): Promise<
  ActionResult<ToApproveSummary[]>
> {
  const session = await requireApproverAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let query = admin
    .from("requisitions")
    .select(
      "id, req_no, needed_by, created_at, departments(name, branches(name)), requisition_lines(id, decision)",
    )
    .eq("status", "submitted");
  if (session.role !== "admin" && session.branchId) {
    query = query.eq("branch_id", session.branchId);
  }
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) return { success: false, error: error.message };

  type Row = {
    id: string;
    req_no: string;
    needed_by: string;
    created_at: string;
    departments: { name: string; branches: { name: string } | null } | null;
    requisition_lines: { id: string; decision: string | null }[];
  };

  return {
    success: true,
    data: (data as unknown as Row[]).map((r) => ({
      id: r.id,
      reqNo: r.req_no,
      departmentName: r.departments?.name ?? "Unknown department",
      branchName: r.departments?.branches?.name ?? "",
      neededBy: r.needed_by,
      lineCount: r.requisition_lines.length,
      decidedCount: r.requisition_lines.filter((l) => l.decision !== null)
        .length,
      createdAt: r.created_at,
    })),
  };
}

type ApprovalLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  qtyG: number;
  godownStockG: number;
  onOrderG: number;
  decision: string | null;
  approvedQtyG: number | null;
  decisionNote: string | null;
};

type ApprovalDetail = {
  id: string;
  reqNo: string;
  status: string;
  neededBy: string;
  departmentName: string;
  lines: ApprovalLine[];
};

export async function getApprovalDetail(
  requisitionId: string,
): Promise<ActionResult<ApprovalDetail>> {
  const session = await requireApproverAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(requisitionId);
  if (!parsed.success) return { success: false, error: "Invalid requisition." };

  const admin = createAdminClient();
  const { data: requisition } = await admin
    .from("requisitions")
    .select("id, req_no, status, needed_by, branch_id, departments(name)")
    .eq("id", parsed.data)
    .single();
  if (!requisition) return { success: false, error: "Requisition not found." };
  if (session.role !== "admin" && requisition.branch_id !== session.branchId) {
    return { success: false, error: "Access required." };
  }

  const { data: lines } = await admin
    .from("requisition_lines")
    .select(
      "id, item_type, item_id, qty_g, decision, approved_qty_g, decision_note",
    )
    .eq("requisition_id", parsed.data)
    .order("created_at", { ascending: true });

  // The department in this branch that stocks and fulfils requisitions —
  // the one place holding raw materials (rule: "the Guwahati godown is a
  // department"). Every branch has exactly one today.
  const { data: godown } = await admin
    .from("departments")
    .select("id")
    .eq("branch_id", requisition.branch_id)
    .eq("holds_raw", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const godownId = godown?.id ?? null;

  const rawIds = (lines ?? [])
    .filter((l) => l.item_type === "raw")
    .map((l) => l.item_id);
  const flavourIds = (lines ?? [])
    .filter((l) => l.item_type === "flavour")
    .map((l) => l.item_id);
  const [{ data: rawMaterials }, { data: flavours }, { data: balances }] =
    await Promise.all([
      rawIds.length > 0
        ? admin.from("raw_materials").select("id, code, name").in("id", rawIds)
        : Promise.resolve({ data: [] }),
      flavourIds.length > 0
        ? admin.from("flavours").select("id, code, name").in("id", flavourIds)
        : Promise.resolve({ data: [] }),
      godownId
        ? admin
            .from("stock_balances")
            .select("item_type, item_id, qty_g")
            .eq("department_id", godownId)
        : Promise.resolve({ data: [] }),
    ]);
  const nameById = new Map(
    [...(rawMaterials ?? []), ...(flavours ?? [])].map((m) => [
      m.id,
      { name: m.name, code: m.code },
    ]),
  );
  const balanceByKey = new Map(
    (balances ?? []).map((b) => [`${b.item_type}|${b.item_id}`, b.qty_g]),
  );

  return {
    success: true,
    data: {
      id: requisition.id,
      reqNo: requisition.req_no,
      status: requisition.status,
      neededBy: requisition.needed_by,
      departmentName:
        (requisition.departments as unknown as { name: string } | null)?.name ??
        "Unknown department",
      lines: (lines ?? []).map((l) => ({
        id: l.id,
        itemType: l.item_type,
        itemId: l.item_id,
        name: nameById.get(l.item_id)?.name ?? "Unknown item",
        code: nameById.get(l.item_id)?.code ?? null,
        qtyG: l.qty_g,
        godownStockG: balanceByKey.get(`${l.item_type}|${l.item_id}`) ?? 0,
        // Purchase orders don't exist until Phase 5 — every raw material
        // shows 0 on order until POs are wired in here.
        onOrderG: 0,
        decision: l.decision,
        approvedQtyG: l.approved_qty_g,
        decisionNote: l.decision_note,
      })),
    },
  };
}

const decisionSchema = z.object({
  lineId: z.uuid(),
  decision: z.enum(["transfer", "mix_then_transfer", "buy", "rejected"]),
  approvedQtyG: z.coerce.number().int().min(0),
  decisionNote: z.string().trim().max(500).nullable(),
});

export async function saveLineDecision(
  input: z.infer<typeof decisionSchema>,
): Promise<ActionResult<null>> {
  const session = await requireApproverAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requisition_lines")
    .update({
      decision: parsed.data.decision,
      approved_qty_g: parsed.data.approvedQtyG,
      decision_note: parsed.data.decisionNote || null,
    })
    .eq("id", parsed.data.lineId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/requisitions/approve");
  return { success: true, data: null };
}
