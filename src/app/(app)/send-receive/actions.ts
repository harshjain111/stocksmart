"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

const SEND_OUT_ROLES = ["admin", "branch_manager", "store_manager"] as const;

async function requireSendOutAccess() {
  const session = await getSession();
  if (
    !session ||
    !SEND_OUT_ROLES.includes(session.role as (typeof SEND_OUT_ROLES)[number])
  ) {
    return null;
  }
  return session;
}

type DraftTransferSummary = {
  id: string;
  transferNo: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  requisitionReqNo: string | null;
  lineCount: number;
  createdAt: string;
};

export async function getDraftTransfers(): Promise<
  ActionResult<DraftTransferSummary[]>
> {
  const session = await requireSendOutAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let query = admin
    .from("transfers")
    .select(
      "id, transfer_no, created_at, from_department:from_department_id(name), to_department:to_department_id(name), requisitions(req_no), transfer_lines(id)",
    )
    .eq("status", "draft");
  if (session.role !== "admin") {
    query = query.eq("branch_id", session.branchId ?? "");
  }
  const { data, error } = await query.order("created_at", {
    ascending: true,
  });
  if (error) return { success: false, error: error.message };

  type Row = {
    id: string;
    transfer_no: string;
    created_at: string;
    from_department: { name: string } | null;
    to_department: { name: string } | null;
    requisitions: { req_no: string } | null;
    transfer_lines: { id: string }[];
  };

  return {
    success: true,
    data: (data as unknown as Row[]).map((t) => ({
      id: t.id,
      transferNo: t.transfer_no,
      fromDepartmentName: t.from_department?.name ?? "Unknown department",
      toDepartmentName: t.to_department?.name ?? "Unknown department",
      requisitionReqNo: t.requisitions?.req_no ?? null,
      lineCount: t.transfer_lines.length,
      createdAt: t.created_at,
    })),
  };
}

export async function getSendOutDepartments(): Promise<
  ActionResult<{ id: string; name: string }[]>
> {
  const session = await requireSendOutAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let query = admin
    .from("departments")
    .select("id, name")
    .eq("is_active", true);
  if (session.role !== "admin") {
    query = query.eq("branch_id", session.branchId ?? "");
  }
  const { data, error } = await query.order("name");
  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

type AvailableItem = {
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  currentStockG: number;
};

export async function getAvailableItemsAtDepartment(
  departmentId: string,
): Promise<ActionResult<AvailableItem[]>> {
  const session = await requireSendOutAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(departmentId);
  if (!parsed.success) return { success: false, error: "Invalid department." };

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

  return {
    success: true,
    data: [
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
    ],
  };
}

const createAdHocSchema = z.object({
  fromDepartmentId: z.uuid(),
  toDepartmentId: z.uuid(),
  lines: z
    .array(
      z.object({
        itemType: z.enum(["raw", "flavour"]),
        itemId: z.uuid(),
        qtyG: z.coerce.number().int().positive(),
      }),
    )
    .min(1, "Add at least one item"),
});

export async function createAdHocTransfer(
  input: z.infer<typeof createAdHocSchema>,
): Promise<ActionResult<{ transferId: string }>> {
  const session = await requireSendOutAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = createAdHocSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { fromDepartmentId, toDepartmentId, lines } = parsed.data;
  if (fromDepartmentId === toDepartmentId) {
    return {
      success: false,
      error: "The sending and receiving department must be different.",
    };
  }

  const admin = createAdminClient();
  const [{ data: fromDept }, { data: toDept }] = await Promise.all([
    admin
      .from("departments")
      .select("branch_id")
      .eq("id", fromDepartmentId)
      .single(),
    admin
      .from("departments")
      .select("branch_id")
      .eq("id", toDepartmentId)
      .single(),
  ]);
  if (!fromDept || !toDept) {
    return { success: false, error: "Department not found." };
  }
  if (fromDept.branch_id !== toDept.branch_id) {
    return {
      success: false,
      error: "Transfers move stock within one branch only.",
    };
  }
  if (session.role !== "admin" && fromDept.branch_id !== session.branchId) {
    return { success: false, error: "Access required." };
  }

  const supabase = await createClient();

  const { data: transferNoRow, error: transferNoError } = await supabase.rpc(
    "next_doc_no",
    { p_doc_type: "TRF", p_branch_id: fromDept.branch_id },
  );
  if (transferNoError || !transferNoRow) {
    return {
      success: false,
      error: transferNoError?.message ?? "Could not generate transfer number.",
    };
  }

  const { data: transfer, error: transferError } = await supabase
    .from("transfers")
    .insert({
      transfer_no: transferNoRow,
      branch_id: fromDept.branch_id,
      from_department_id: fromDepartmentId,
      to_department_id: toDepartmentId,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (transferError || !transfer) {
    return {
      success: false,
      error: transferError?.message ?? "Could not create transfer.",
    };
  }

  const { error: linesError } = await supabase.from("transfer_lines").insert(
    lines.map((l) => ({
      transfer_id: transfer.id,
      item_type: l.itemType,
      item_id: l.itemId,
      qty_g: l.qtyG,
    })),
  );
  if (linesError) return { success: false, error: linesError.message };

  revalidatePath("/send-receive");
  return { success: true, data: { transferId: transfer.id } };
}

type TransferLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  qtyG: number;
  currentStockG: number;
};

type TransferDetail = {
  id: string;
  transferNo: string;
  status: string;
  fromDepartmentId: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  requisitionReqNo: string | null;
  courier: string | null;
  transportationCost: number | null;
  docketNo: string | null;
  lines: TransferLine[];
};

export async function getTransferDetail(
  transferId: string,
): Promise<ActionResult<TransferDetail>> {
  const session = await requireSendOutAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(transferId);
  if (!parsed.success) return { success: false, error: "Invalid transfer." };

  const admin = createAdminClient();
  const { data: transfer } = await admin
    .from("transfers")
    .select(
      "id, transfer_no, status, branch_id, courier, docket_no, transportation_cost, from_department:from_department_id(id, name), to_department:to_department_id(name), requisitions(req_no)",
    )
    .eq("id", parsed.data)
    .single();
  if (!transfer) return { success: false, error: "Transfer not found." };
  if (session.role !== "admin" && transfer.branch_id !== session.branchId) {
    return { success: false, error: "Access required." };
  }

  const fromDepartment = transfer.from_department as unknown as {
    id: string;
    name: string;
  } | null;
  const toDepartment = transfer.to_department as unknown as {
    name: string;
  } | null;
  const requisition = transfer.requisitions as unknown as {
    req_no: string;
  } | null;

  const { data: lines } = await admin
    .from("transfer_lines")
    .select("id, item_type, item_id, qty_g")
    .eq("transfer_id", parsed.data)
    .order("created_at", { ascending: true });

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
      fromDepartment
        ? admin
            .from("stock_balances")
            .select("item_type, item_id, qty_g")
            .eq("department_id", fromDepartment.id)
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
      id: transfer.id,
      transferNo: transfer.transfer_no,
      status: transfer.status,
      fromDepartmentId: fromDepartment?.id ?? "",
      fromDepartmentName: fromDepartment?.name ?? "Unknown department",
      toDepartmentName: toDepartment?.name ?? "Unknown department",
      requisitionReqNo: requisition?.req_no ?? null,
      courier: transfer.courier,
      docketNo: transfer.docket_no,
      transportationCost:
        transfer.transportation_cost == null
          ? null
          : Number(transfer.transportation_cost),
      lines: (lines ?? []).map((l) => ({
        id: l.id,
        itemType: l.item_type,
        itemId: l.item_id,
        name: nameById.get(l.item_id)?.name ?? "Unknown item",
        code: nameById.get(l.item_id)?.code ?? null,
        qtyG: l.qty_g,
        currentStockG: balanceByKey.get(`${l.item_type}|${l.item_id}`) ?? 0,
      })),
    },
  };
}

export async function updateTransferLineQty(
  lineId: string,
  qtyG: number,
): Promise<ActionResult<null>> {
  const session = await requireSendOutAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsedId = z.uuid().safeParse(lineId);
  if (!parsedId.success) return { success: false, error: "Invalid line." };
  const parsedQty = z.coerce.number().int().positive().safeParse(qtyG);
  if (!parsedQty.success) return { success: false, error: "Invalid quantity." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("transfer_lines")
    .update({ qty_g: parsedQty.data })
    .eq("id", parsedId.data);
  if (error) return { success: false, error: error.message };

  revalidatePath("/send-receive");
  return { success: true, data: null };
}

// Freight for this leg of the journey. Captured while the transfer is
// still draft (that's all the RLS update policy allows, and it's when the
// courier is booked anyway). Supplier -> godown freight lives on the
// vendor GRN; this is every onward leg, so landed cost can accumulate
// across the whole chain instead of treating a transfer as a new purchase.
export async function setTransferTransportationCost(
  transferId: string,
  cost: number | null,
): Promise<ActionResult<null>> {
  const session = await requireSendOutAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsedId = z.uuid().safeParse(transferId);
  if (!parsedId.success) return { success: false, error: "Invalid transfer." };
  const parsedCost = z.coerce.number().nonnegative().nullable().safeParse(cost);
  if (!parsedCost.success) {
    return { success: false, error: "Transportation cost can't be negative." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("transfers")
    .update({ transportation_cost: parsedCost.data })
    .eq("id", parsedId.data);
  if (error) return { success: false, error: error.message };

  revalidatePath("/send-receive");
  return { success: true, data: null };
}

const dispatchSchema = z.object({
  transferId: z.uuid(),
  courier: z.string().trim().max(120).nullable(),
  docketNo: z.string().trim().max(120).nullable(),
});

export async function dispatchTransfer(
  input: z.infer<typeof dispatchSchema>,
): Promise<ActionResult<null>> {
  const session = await requireSendOutAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("dispatch_transfer", {
    p_transfer_id: parsed.data.transferId,
    p_courier: parsed.data.courier || null,
    p_docket_no: parsed.data.docketNo || null,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/send-receive");
  return { success: true, data: null };
}
