import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { WhatWeHaveView } from "@/components/stock/what-we-have-view";

type DepartmentRow = {
  id: string;
  name: string;
  branch_id: string;
  holds_raw: boolean;
  holds_mixed: boolean;
};

export default async function StockPage() {
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager", "hod"].includes(session.role)
  ) {
    redirect("/");
  }

  const admin = createAdminClient();

  let departmentsQuery = admin
    .from("departments")
    .select("id, name, branch_id, holds_raw, holds_mixed")
    .eq("is_active", true);

  if (session.role === "hod") {
    const deptIds = session.departments.map((d) => d.id);
    departmentsQuery =
      deptIds.length > 0
        ? departmentsQuery.in("id", deptIds)
        : departmentsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  } else if (session.role !== "admin" && session.branchId) {
    departmentsQuery = departmentsQuery.eq("branch_id", session.branchId);
  }

  const [{ data: branches }, { data: departments }, { data: rawMaterials }, { data: flavours }] =
    await Promise.all([
      admin
        .from("branches")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      departmentsQuery.order("name").returns<DepartmentRow[]>(),
      admin
        .from("raw_materials")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name"),
      admin
        .from("flavours")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name"),
    ]);
  const visibleDepartmentIds = (departments ?? []).map((d) => d.id);

  const [{ data: balances }, { data: parLevels }] =
    visibleDepartmentIds.length > 0
      ? await Promise.all([
          admin
            .from("stock_balances")
            .select("department_id, item_type, item_id, qty_g")
            .in("department_id", visibleDepartmentIds),
          admin
            .from("par_levels")
            .select("department_id, item_id, par_qty_g")
            .eq("item_type", "flavour")
            .in("department_id", visibleDepartmentIds),
        ])
      : [{ data: [] }, { data: [] }];

  return (
    <WhatWeHaveView
      branches={
        session.role === "admin"
          ? (branches ?? [])
          : (branches ?? []).filter((b) => b.id === session.branchId)
      }
      departments={departments ?? []}
      rawMaterials={rawMaterials ?? []}
      flavours={flavours ?? []}
      balances={balances ?? []}
      parLevels={parLevels ?? []}
      lockedToBranchId={session.role === "admin" ? null : session.branchId}
    />
  );
}
