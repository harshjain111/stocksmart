import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessStockTab } from "@/lib/stock-tabs";
import { CountStockView } from "@/components/stock/count-stock-view";

export default async function CountStockPage() {
  const session = await getSession();
  if (!session || !canAccessStockTab(session.role, "/stock/count")) {
    redirect("/stock");
  }

  const admin = createAdminClient();

  let departmentsQuery = admin
    .from("departments")
    .select("id, name, holds_raw, holds_mixed, branches(name)")
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

  const { data: departments } = await departmentsQuery.order("name");

  return (
    <CountStockView
      departments={(departments ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        branchName:
          (d.branches as unknown as { name: string } | null)?.name ?? "",
        holdsRaw: d.holds_raw,
        holdsMixed: d.holds_mixed,
      }))}
      isApprover={["admin", "store_manager"].includes(session.role)}
    />
  );
}
