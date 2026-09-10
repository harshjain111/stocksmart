import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/auth/permissions";
import { getVarianceData } from "@/lib/stock/variance";
import { formatGrams } from "@/lib/units";
import { CountStockView } from "@/components/stock/count-stock-view";
import { CountVarianceView } from "@/components/stock/count-variance-view";

export default async function CountAndVariancePage() {
  const session = await getSession();
  if (!session || !can(session.role, "stock:count")) {
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

  const [{ data: departments }, variance] = await Promise.all([
    departmentsQuery.order("name"),
    getVarianceData(session),
  ]);

  const { totals } = variance;

  return (
    <div className="flex flex-col gap-6">
      <CountStockView
        departments={(departments ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          branchName:
            (d.branches as unknown as { name: string } | null)?.name ?? "",
          holdsRaw: d.holds_raw,
          holdsMixed: d.holds_mixed,
        }))}
        isApprover={can(session.role, "stock:approve-count")}
      />

      <div className="grid gap-4">
        <div>
          <h2 className="text-base font-semibold">Variance History</h2>
          <p className="text-muted-foreground text-sm">
            Every approved adjustment, from both daily closing updates and
            full count sheets.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Total Adjustments",
              value: String(totals.adjustments),
              tone: "",
            },
            {
              label: "Positive Variance",
              value: formatGrams(totals.positiveG),
              tone: "text-success",
            },
            {
              label: "Negative Variance",
              value: formatGrams(totals.negativeG),
              tone: "text-destructive",
            },
            {
              label: "Net Variance",
              value: `${totals.netG > 0 ? "+" : ""}${formatGrams(totals.netG)}`,
              tone: totals.netG < 0 ? "text-destructive" : "text-success",
            },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-card rounded-lg border p-4">
              <p className={`font-qty text-lg leading-none ${kpi.tone}`}>
                {kpi.value}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{kpi.label}</p>
            </div>
          ))}
        </div>

        <CountVarianceView
          byDepartment={variance.byDepartment}
          byItem={variance.byItem}
          byPeriod={variance.byPeriod}
          detail={variance.detail}
        />
      </div>
    </div>
  );
}
