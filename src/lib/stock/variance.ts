import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { weekKeyIst, weekLabelIst } from "@/lib/week";
import type { Session } from "@/lib/auth/session";

/**
 * Variance history (§31), shared by the Count & Variance page.
 *
 * Every approved count contributes, whichever workflow produced it — a
 * formal reconciliation and a daily close both end up as an approved
 * stock_count, and both are equally worth auditing. That is the payoff for
 * keeping them in one table rather than two.
 */

export type VarianceDetailRow = {
  countId: string;
  countNo: string;
  departmentName: string;
  approvedAt: string | null;
  itemName: string;
  itemCode: string | null;
  systemQtyG: number;
  countedQtyG: number;
  varianceG: number;
  reason: string | null;
};

export type VarianceData = {
  byDepartment: { name: string; varianceG: number }[];
  byItem: { name: string; code: string | null; varianceG: number }[];
  byPeriod: { key: string; label: string; varianceG: number }[];
  detail: VarianceDetailRow[];
  totals: {
    adjustments: number;
    positiveG: number;
    negativeG: number;
    netG: number;
  };
};

type CountRow = {
  id: string;
  count_no: string;
  approved_at: string | null;
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

export async function getVarianceData(session: Session): Promise<VarianceData> {
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
        : countsQuery.eq("department_id", "00000000-0000-0000-0000-000000000000");
  } else if (session.role !== "admin" && session.branchId) {
    countsQuery = countsQuery.eq("branch_id", session.branchId);
  }

  const { data: counts } = await countsQuery
    .order("approved_at", { ascending: false })
    .limit(500)
    .returns<CountRow[]>();

  const countIds = (counts ?? []).map((c) => c.id);
  const empty: VarianceData = {
    byDepartment: [],
    byItem: [],
    byPeriod: [],
    detail: [],
    totals: { adjustments: 0, positiveG: 0, negativeG: 0, netG: 0 },
  };
  if (countIds.length === 0) return empty;

  const { data: lines } = await admin
    .from("stock_count_lines")
    .select("count_id, item_type, item_id, system_qty_g, counted_qty_g, reason")
    .in("count_id", countIds)
    .returns<LineRow[]>();

  // Only lines that actually moved the balance are variances. A line
  // counted at exactly what the system said is a confirmation, not an
  // adjustment, and padding the report with them hides the real ones.
  const diffLines = (lines ?? []).filter(
    (l) => l.counted_qty_g != null && l.counted_qty_g !== l.system_qty_g,
  );
  if (diffLines.length === 0) return empty;

  const rawIds = diffLines.filter((l) => l.item_type === "raw").map((l) => l.item_id);
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

  const detail: VarianceDetailRow[] = diffLines.map((l) => {
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

  const aggregate = (keyFn: (row: VarianceDetailRow) => string) => {
    const groups = new Map<string, number>();
    for (const row of detail) {
      groups.set(keyFn(row), (groups.get(keyFn(row)) ?? 0) + row.varianceG);
    }
    return groups;
  };

  const byDepartment = [...aggregate((r) => r.departmentName).entries()]
    .map(([name, varianceG]) => ({ name, varianceG }))
    .sort((a, b) => Math.abs(b.varianceG) - Math.abs(a.varianceG));

  const byItem = [...aggregate((r) => `${r.itemName}|${r.itemCode ?? ""}`).entries()]
    .map(([key, varianceG]) => {
      const [name, code] = key.split("|");
      return { name, code: code || null, varianceG };
    })
    .sort((a, b) => Math.abs(b.varianceG) - Math.abs(a.varianceG));

  const byPeriod = [
    ...aggregate((r) => (r.approvedAt ? weekKeyIst(r.approvedAt) : "unknown")).entries(),
  ]
    .map(([key, varianceG]) => ({
      key,
      label:
        key === "unknown"
          ? "Unknown"
          : weekLabelIst(
              detail.find((r) => r.approvedAt && weekKeyIst(r.approvedAt) === key)!
                .approvedAt!,
            ),
      varianceG,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  const positiveG = detail
    .filter((d) => d.varianceG > 0)
    .reduce((s, d) => s + d.varianceG, 0);
  const negativeG = detail
    .filter((d) => d.varianceG < 0)
    .reduce((s, d) => s + d.varianceG, 0);

  return {
    byDepartment,
    byItem,
    byPeriod,
    detail,
    totals: {
      adjustments: detail.length,
      positiveG,
      negativeG,
      netG: positiveG + negativeG,
    },
  };
}
