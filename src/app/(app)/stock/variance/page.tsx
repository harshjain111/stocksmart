import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessStockTab } from "@/lib/stock-tabs";
import { CountVarianceView } from "@/components/stock/count-variance-view";
import { weekKeyIst, weekLabelIst } from "@/lib/week";

type CountRow = {
  id: string;
  count_no: string;
  approved_at: string;
  department_id: string;
  departments: { name: string } | null;
};

type LineRow = {
  count_id: string;
  item_type: "raw" | "flavour";
  item_id: string;
  system_qty_g: number;
  counted_qty_g: number | null;
  reason: string | null;
};

export default async function CountVariancePage() {
  const session = await getSession();
  if (!session || !canAccessStockTab(session.role, "/stock/variance")) {
    redirect("/stock");
  }

  const admin = createAdminClient();

  let countsQuery = admin
    .from("stock_counts")
    .select("id, count_no, approved_at, department_id, departments(name)")
    .eq("status", "approved");

  if (session.role === "hod") {
    const deptIds = session.departments.map((d) => d.id);
    countsQuery =
      deptIds.length > 0
        ? countsQuery.in("department_id", deptIds)
        : countsQuery.eq(
            "department_id",
            "00000000-0000-0000-0000-000000000000",
          );
  } else if (session.role !== "admin" && session.branchId) {
    countsQuery = countsQuery.eq("branch_id", session.branchId);
  }

  const { data: counts } = await countsQuery
    .order("approved_at", { ascending: false })
    .returns<CountRow[]>();

  const countIds = (counts ?? []).map((c) => c.id);
  const { data: lines } =
    countIds.length > 0
      ? await admin
          .from("stock_count_lines")
          .select(
            "count_id, item_type, item_id, system_qty_g, counted_qty_g, reason",
          )
          .in("count_id", countIds)
          .returns<LineRow[]>()
      : { data: [] };

  const diffLines = (lines ?? []).filter(
    (l) => l.counted_qty_g != null && l.counted_qty_g !== l.system_qty_g,
  );

  const rawIds = diffLines
    .filter((l) => l.item_type === "raw")
    .map((l) => l.item_id);
  const flavourIds = diffLines
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
  const countById = new Map((counts ?? []).map((c) => [c.id, c]));

  const detail = diffLines.map((l) => {
    const count = countById.get(l.count_id);
    const item = nameById.get(l.item_id);
    return {
      countId: l.count_id,
      countNo: count?.count_no ?? "Unknown",
      departmentName: count?.departments?.name ?? "Unknown department",
      approvedAt: count?.approved_at ?? null,
      itemName: item?.name ?? "Unknown item",
      itemCode: item?.code ?? null,
      systemQtyG: l.system_qty_g,
      countedQtyG: l.counted_qty_g as number,
      varianceG: (l.counted_qty_g as number) - l.system_qty_g,
      reason: l.reason,
    };
  });

  function aggregate(keyFn: (row: (typeof detail)[number]) => string) {
    const groups = new Map<string, number>();
    for (const row of detail) {
      groups.set(keyFn(row), (groups.get(keyFn(row)) ?? 0) + row.varianceG);
    }
    return groups;
  }

  const byDepartment = [...aggregate((r) => r.departmentName).entries()]
    .map(([name, varianceG]) => ({ name, varianceG }))
    .sort((a, b) => Math.abs(b.varianceG) - Math.abs(a.varianceG));

  const byItem = [
    ...aggregate((r) => `${r.itemName}|${r.itemCode ?? ""}`).entries(),
  ]
    .map(([key, varianceG]) => {
      const [name, code] = key.split("|");
      return { name, code: code || null, varianceG };
    })
    .sort((a, b) => Math.abs(b.varianceG) - Math.abs(a.varianceG));

  const byWeekGroups = aggregate((r) =>
    r.approvedAt ? weekKeyIst(r.approvedAt) : "unknown",
  );
  const byPeriod = [...byWeekGroups.entries()]
    .map(([key, varianceG]) => ({
      key,
      label:
        key === "unknown"
          ? "Unknown"
          : weekLabelIst(
              detail.find(
                (r) => r.approvedAt && weekKeyIst(r.approvedAt) === key,
              )!.approvedAt!,
            ),
      varianceG,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  return (
    <CountVarianceView
      byDepartment={byDepartment}
      byItem={byItem}
      byPeriod={byPeriod}
      detail={detail}
    />
  );
}
