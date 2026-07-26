"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

const VIEWER_ROLES = ["admin", "branch_manager", "store_manager"] as const;

async function requireViewerAccess() {
  const session = await getSession();
  if (
    !session ||
    !VIEWER_ROLES.includes(session.role as (typeof VIEWER_ROLES)[number])
  ) {
    return null;
  }
  return session;
}

export type RequisitionFilters = {
  branchId?: string;
  departmentId?: string;
  status?: string;
  raisedFrom?: string;
  raisedTo?: string;
};

type RequisitionRow = {
  id: string;
  reqNo: string;
  branchName: string;
  departmentName: string;
  status: string;
  neededBy: string;
  createdAt: string;
  lineCount: number;
};

export async function getBranchesAndDepartments(): Promise<
  ActionResult<{
    branches: { id: string; name: string }[];
    departments: { id: string; name: string; branchId: string }[];
  }>
> {
  const session = await requireViewerAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  const [{ data: branches }, { data: departments }] = await Promise.all([
    admin.from("branches").select("id, name").order("name"),
    admin
      .from("departments")
      .select("id, name, branch_id")
      .eq("is_active", true)
      .order("name"),
  ]);

  const scopedBranches =
    session.role === "admin"
      ? (branches ?? [])
      : (branches ?? []).filter((b) => b.id === session.branchId);

  return {
    success: true,
    data: {
      branches: scopedBranches,
      departments: (departments ?? [])
        .filter(
          (d) => session.role === "admin" || d.branch_id === session.branchId,
        )
        .map((d) => ({ id: d.id, name: d.name, branchId: d.branch_id })),
    },
  };
}

export async function getAllRequisitions(
  filters: RequisitionFilters,
): Promise<ActionResult<RequisitionRow[]>> {
  const session = await requireViewerAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let query = admin
    .from("requisitions")
    .select(
      "id, req_no, needed_by, created_at, status, branch_id, departments(name, branches(name)), requisition_lines(id)",
    );

  if (session.role === "admin") {
    if (filters.branchId) query = query.eq("branch_id", filters.branchId);
  } else {
    query = query.eq("branch_id", session.branchId ?? "");
  }
  if (filters.departmentId)
    query = query.eq("department_id", filters.departmentId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.raisedFrom) query = query.gte("created_at", filters.raisedFrom);
  if (filters.raisedTo) query = query.lte("created_at", filters.raisedTo);

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });
  if (error) return { success: false, error: error.message };

  type Row = {
    id: string;
    req_no: string;
    needed_by: string;
    created_at: string;
    status: string;
    departments: { name: string; branches: { name: string } | null } | null;
    requisition_lines: { id: string }[];
  };

  return {
    success: true,
    data: (data as unknown as Row[]).map((r) => ({
      id: r.id,
      reqNo: r.req_no,
      branchName: r.departments?.branches?.name ?? "",
      departmentName: r.departments?.name ?? "Unknown department",
      status: r.status,
      neededBy: r.needed_by,
      createdAt: r.created_at,
      lineCount: r.requisition_lines.length,
    })),
  };
}

type TimelineStep = {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
};

type RequisitionTimeline = {
  id: string;
  reqNo: string;
  steps: TimelineStep[];
};

export async function getRequisitionTimeline(
  requisitionId: string,
): Promise<ActionResult<RequisitionTimeline>> {
  const session = await requireViewerAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(requisitionId);
  if (!parsed.success) return { success: false, error: "Invalid requisition." };

  const admin = createAdminClient();
  const { data: requisition } = await admin
    .from("requisitions")
    .select(
      "id, req_no, branch_id, created_at, submitted_at, approved_at, status",
    )
    .eq("id", parsed.data)
    .single();
  if (!requisition) return { success: false, error: "Requisition not found." };
  if (session.role !== "admin" && requisition.branch_id !== session.branchId) {
    return { success: false, error: "Access required." };
  }

  const { data: transfer } = await admin
    .from("transfers")
    .select("status, dispatched_at")
    .eq("requisition_id", parsed.data)
    .maybeSingle();

  const steps: TimelineStep[] = [
    {
      key: "raised",
      label: "Raised",
      at: requisition.created_at,
      done: true,
    },
    {
      key: "submitted",
      label: "Submitted",
      at: requisition.submitted_at,
      done: !!requisition.submitted_at,
    },
    {
      key: "approved",
      label: "Approved",
      at: requisition.approved_at,
      done: !!requisition.approved_at,
    },
  ];

  if (requisition.status === "rejected") {
    steps.push({ key: "rejected", label: "Rejected", at: null, done: true });
  }

  if (transfer) {
    steps.push({
      key: "dispatched",
      label: "Dispatched",
      at: transfer.dispatched_at,
      done: transfer.status !== "draft",
    });
    steps.push({
      key: "received",
      label: "Received",
      at: null,
      done: transfer.status === "received" || transfer.status === "closed",
    });
  }

  return {
    success: true,
    data: { id: requisition.id, reqNo: requisition.req_no, steps },
  };
}
