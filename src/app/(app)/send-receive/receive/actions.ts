"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

const RECEIVE_ROLES = [
  "admin",
  "branch_manager",
  "store_manager",
  "hod",
] as const;

async function requireReceiveAccess() {
  const session = await getSession();
  if (
    !session ||
    !RECEIVE_ROLES.includes(session.role as (typeof RECEIVE_ROLES)[number])
  ) {
    return null;
  }
  return session;
}

function scopedToDepartmentIds(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): string[] | null {
  if (session.role === "hod") return session.departments.map((d) => d.id);
  return null;
}

type InboundTransfer = {
  id: string;
  transferNo: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  requisitionReqNo: string | null;
  dispatchedAt: string;
  lineCount: number;
  existingGrnId: string | null;
  existingGrnStatus: string | null;
};

export async function getInboundTransfers(): Promise<
  ActionResult<InboundTransfer[]>
> {
  const session = await requireReceiveAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let query = admin
    .from("transfers")
    .select(
      "id, transfer_no, dispatched_at, to_department_id, from_department:from_department_id(name), to_department:to_department_id(name), requisitions(req_no), transfer_lines(id), grns(id, status)",
    )
    .eq("status", "dispatched");

  const departmentIds = scopedToDepartmentIds(session);
  if (departmentIds) {
    if (departmentIds.length === 0) return { success: true, data: [] };
    query = query.in("to_department_id", departmentIds);
  } else if (session.role !== "admin") {
    query = query.eq("branch_id", session.branchId ?? "");
  }

  const { data, error } = await query.order("dispatched_at", {
    ascending: true,
  });
  if (error) return { success: false, error: error.message };

  type Row = {
    id: string;
    transfer_no: string;
    dispatched_at: string;
    from_department: { name: string } | null;
    to_department: { name: string } | null;
    requisitions: { req_no: string } | null;
    transfer_lines: { id: string }[];
    grns: { id: string; status: string }[];
  };

  return {
    success: true,
    data: (data as unknown as Row[]).map((t) => ({
      id: t.id,
      transferNo: t.transfer_no,
      fromDepartmentName: t.from_department?.name ?? "Unknown department",
      toDepartmentName: t.to_department?.name ?? "Unknown department",
      requisitionReqNo: t.requisitions?.req_no ?? null,
      dispatchedAt: t.dispatched_at,
      lineCount: t.transfer_lines.length,
      existingGrnId: t.grns[0]?.id ?? null,
      existingGrnStatus: t.grns[0]?.status ?? null,
    })),
  };
}

async function loadTransferForReceive(
  admin: ReturnType<typeof createAdminClient>,
  transferId: string,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
) {
  const { data: transfer } = await admin
    .from("transfers")
    .select("id, branch_id, to_department_id, status")
    .eq("id", transferId)
    .single();
  if (!transfer) return null;

  const departmentIds = scopedToDepartmentIds(session);
  if (departmentIds && !departmentIds.includes(transfer.to_department_id)) {
    return null;
  }
  if (
    !departmentIds &&
    session.role !== "admin" &&
    transfer.branch_id !== session.branchId
  ) {
    return null;
  }
  return transfer;
}

export async function getOrCreateGrnForTransfer(
  transferId: string,
): Promise<ActionResult<{ grnId: string }>> {
  const session = await requireReceiveAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(transferId);
  if (!parsed.success) return { success: false, error: "Invalid transfer." };

  const admin = createAdminClient();
  const transfer = await loadTransferForReceive(admin, parsed.data, session);
  if (!transfer) return { success: false, error: "Transfer not found." };
  if (transfer.status !== "dispatched") {
    return { success: false, error: "This transfer is not awaiting receipt." };
  }

  const { data: existingGrn } = await admin
    .from("grns")
    .select("id")
    .eq("transfer_id", parsed.data)
    .maybeSingle();
  if (existingGrn) {
    return { success: true, data: { grnId: existingGrn.id } };
  }

  const { data: transferLines } = await admin
    .from("transfer_lines")
    .select("item_type, item_id, dispatched_qty_g, qty_g")
    .eq("transfer_id", parsed.data);
  if (!transferLines || transferLines.length === 0) {
    return { success: false, error: "This transfer has no lines." };
  }

  const supabase = await createClient();

  const { data: grnNoRow, error: grnNoError } = await supabase.rpc(
    "next_doc_no",
    { p_doc_type: "GRN", p_branch_id: transfer.branch_id },
  );
  if (grnNoError || !grnNoRow) {
    return {
      success: false,
      error: grnNoError?.message ?? "Could not generate GRN number.",
    };
  }

  const { data: grn, error: grnError } = await supabase
    .from("grns")
    .insert({
      grn_no: grnNoRow,
      branch_id: transfer.branch_id,
      department_id: transfer.to_department_id,
      source: "internal",
      transfer_id: parsed.data,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (grnError || !grn) {
    return {
      success: false,
      error: grnError?.message ?? "Could not create GRN.",
    };
  }

  const { error: linesError } = await supabase.from("grn_lines").insert(
    transferLines.map((l) => ({
      grn_id: grn.id,
      item_type: l.item_type,
      item_id: l.item_id,
      expected_qty_g: l.dispatched_qty_g ?? l.qty_g,
    })),
  );
  if (linesError) return { success: false, error: linesError.message };

  revalidatePath("/send-receive/receive");
  return { success: true, data: { grnId: grn.id } };
}

type GrnLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  expectedQtyG: number;
  receivedQtyG: number | null;
  damagedQtyG: number | null;
  reason: string | null;
  overReceived: boolean;
};

type GrnDetail = {
  id: string;
  grnNo: string;
  status: string;
  departmentName: string;
  transferNo: string | null;
  fromDepartmentName: string | null;
  requisitionReqNo: string | null;
  lines: GrnLine[];
};

export async function getGrnDetail(
  grnId: string,
): Promise<ActionResult<GrnDetail>> {
  const session = await requireReceiveAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(grnId);
  if (!parsed.success) return { success: false, error: "Invalid GRN." };

  const admin = createAdminClient();
  const { data: grn } = await admin
    .from("grns")
    .select(
      "id, grn_no, status, branch_id, department:department_id(name, id), transfers(transfer_no, from_department:from_department_id(name), requisitions(req_no))",
    )
    .eq("id", parsed.data)
    .single();
  if (!grn) return { success: false, error: "GRN not found." };

  const department = grn.department as unknown as {
    name: string;
    id: string;
  } | null;
  const departmentIds = scopedToDepartmentIds(session);
  if (departmentIds && !departmentIds.includes(department?.id ?? "")) {
    return { success: false, error: "Access required." };
  }
  if (
    !departmentIds &&
    session.role !== "admin" &&
    grn.branch_id !== session.branchId
  ) {
    return { success: false, error: "Access required." };
  }

  const transfer = grn.transfers as unknown as {
    transfer_no: string;
    from_department: { name: string } | null;
    requisitions: { req_no: string } | null;
  } | null;

  const { data: lines } = await admin
    .from("grn_lines")
    .select(
      "id, item_type, item_id, expected_qty_g, received_qty_g, damaged_qty_g, reason, over_received",
    )
    .eq("grn_id", parsed.data)
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
      id: grn.id,
      grnNo: grn.grn_no,
      status: grn.status,
      departmentName: department?.name ?? "Unknown department",
      transferNo: transfer?.transfer_no ?? null,
      fromDepartmentName: transfer?.from_department?.name ?? null,
      requisitionReqNo: transfer?.requisitions?.req_no ?? null,
      lines: (lines ?? []).map((l) => ({
        id: l.id,
        itemType: l.item_type,
        itemId: l.item_id,
        name: nameById.get(l.item_id)?.name ?? "Unknown item",
        code: nameById.get(l.item_id)?.code ?? null,
        expectedQtyG: l.expected_qty_g,
        receivedQtyG: l.received_qty_g,
        damagedQtyG: l.damaged_qty_g,
        reason: l.reason,
        overReceived: l.over_received,
      })),
    },
  };
}

const updateLineSchema = z.object({
  lineId: z.uuid(),
  receivedQtyG: z.coerce.number().int().min(0),
  damagedQtyG: z.coerce.number().int().min(0),
  reason: z.string().trim().max(500).nullable(),
  overReceived: z.boolean(),
});

export async function updateGrnLine(
  input: z.infer<typeof updateLineSchema>,
): Promise<ActionResult<null>> {
  const session = await requireReceiveAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = updateLineSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("grn_lines")
    .update({
      received_qty_g: parsed.data.receivedQtyG,
      damaged_qty_g: parsed.data.damagedQtyG,
      reason: parsed.data.reason || null,
      over_received: parsed.data.overReceived,
    })
    .eq("id", parsed.data.lineId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/send-receive/receive");
  return { success: true, data: null };
}

export async function postGrn(grnId: string): Promise<ActionResult<null>> {
  const session = await requireReceiveAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(grnId);
  if (!parsed.success) return { success: false, error: "Invalid GRN." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_grn", {
    p_grn_id: parsed.data,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/send-receive/receive");
  revalidatePath("/send-receive/in-transit");
  return { success: true, data: null };
}
