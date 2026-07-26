"use server";

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

export type InTransitTransfer = {
  id: string;
  transferNo: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  requisitionReqNo: string | null;
  courier: string | null;
  docketNo: string | null;
  dispatchedAt: string;
  ageDays: number;
  lineCount: number;
};

export async function getInTransitTransfers(): Promise<
  ActionResult<InTransitTransfer[]>
> {
  const session = await requireViewerAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let query = admin
    .from("transfers")
    .select(
      "id, transfer_no, courier, docket_no, dispatched_at, from_department:from_department_id(name), to_department:to_department_id(name), requisitions(req_no), transfer_lines(id)",
    )
    .eq("status", "dispatched");
  if (session.role !== "admin") {
    query = query.eq("branch_id", session.branchId ?? "");
  }
  const { data, error } = await query.order("dispatched_at", {
    ascending: true,
  });
  if (error) return { success: false, error: error.message };

  type Row = {
    id: string;
    transfer_no: string;
    courier: string | null;
    docket_no: string | null;
    dispatched_at: string;
    from_department: { name: string } | null;
    to_department: { name: string } | null;
    requisitions: { req_no: string } | null;
    transfer_lines: { id: string }[];
  };

  const now = Date.now();
  return {
    success: true,
    data: (data as unknown as Row[]).map((t) => ({
      id: t.id,
      transferNo: t.transfer_no,
      fromDepartmentName: t.from_department?.name ?? "Unknown department",
      toDepartmentName: t.to_department?.name ?? "Unknown department",
      requisitionReqNo: t.requisitions?.req_no ?? null,
      courier: t.courier,
      docketNo: t.docket_no,
      dispatchedAt: t.dispatched_at,
      ageDays: Math.floor(
        (now - new Date(t.dispatched_at).getTime()) / (24 * 60 * 60 * 1000),
      ),
      lineCount: t.transfer_lines.length,
    })),
  };
}
