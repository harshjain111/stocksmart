import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { VarianceView } from "@/components/mix/variance-view";
import { weekKeyIst, weekLabelIst } from "@/lib/week";

type ConsumptionRow = {
  planned_g: number;
  actual_g: number | null;
  raw_materials: { name: string; code: string | null } | null;
};

type BatchRow = {
  id: string;
  batch_no: string;
  mixed_at: string | null;
  mixed_by: string | null;
  batch_consumption: ConsumptionRow[];
};

export default async function MixingVariancePage() {
  const session = await getSession();
  if (!session || !["admin", "senior_mixer"].includes(session.role)) {
    redirect("/");
  }

  const admin = createAdminClient();

  let batchesQuery = admin
    .from("batches")
    .select(
      "id, batch_no, mixed_at, mixed_by, batch_consumption(planned_g, actual_g, raw_materials(name, code))",
    )
    .eq("status", "confirmed")
    .order("mixed_at", { ascending: false });
  if (session.role !== "admin" && session.branchId) {
    batchesQuery = batchesQuery.eq("branch_id", session.branchId);
  }
  const { data: batches } = await batchesQuery.returns<BatchRow[]>();

  const mixedByIds = [
    ...new Set(
      (batches ?? []).map((b) => b.mixed_by).filter((id): id is string => !!id),
    ),
  ];
  const { data: profiles } =
    mixedByIds.length > 0
      ? await admin
          .from("profiles")
          .select("id, full_name")
          .in("id", mixedByIds)
      : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const detailRows = (batches ?? []).flatMap((b) =>
    b.batch_consumption
      .filter((c) => c.actual_g != null)
      .map((c) => ({
        batchNo: b.batch_no,
        mixedAt: b.mixed_at,
        mixedByName: b.mixed_by ? (nameById.get(b.mixed_by) ?? "Unknown") : "—",
        materialName: c.raw_materials?.name ?? "Unknown material",
        materialCode: c.raw_materials?.code ?? null,
        plannedG: c.planned_g,
        actualG: c.actual_g as number,
        varianceG: (c.actual_g as number) - c.planned_g,
      })),
  );

  function aggregate(keyFn: (row: (typeof detailRows)[number]) => string) {
    const groups = new Map<string, { plannedG: number; actualG: number }>();
    for (const row of detailRows) {
      const key = keyFn(row);
      const g = groups.get(key) ?? { plannedG: 0, actualG: 0 };
      g.plannedG += row.plannedG;
      g.actualG += row.actualG;
      groups.set(key, g);
    }
    return groups;
  }

  const byWeekGroups = aggregate((r) =>
    r.mixedAt ? weekKeyIst(r.mixedAt) : "unknown",
  );
  const byWeek = [...byWeekGroups.entries()]
    .map(([key, g]) => ({
      key,
      label:
        key === "unknown"
          ? "Unknown"
          : weekLabelIst(
              detailRows.find(
                (r) => r.mixedAt && weekKeyIst(r.mixedAt) === key,
              )!.mixedAt!,
            ),
      plannedG: g.plannedG,
      actualG: g.actualG,
      varianceG: g.actualG - g.plannedG,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  const byMixerGroups = aggregate((r) => r.mixedByName);
  const byMixer = [...byMixerGroups.entries()]
    .map(([mixerName, g]) => ({
      mixerName,
      plannedG: g.plannedG,
      actualG: g.actualG,
      varianceG: g.actualG - g.plannedG,
    }))
    .sort((a, b) => Math.abs(b.varianceG) - Math.abs(a.varianceG));

  return <VarianceView detail={detailRows} byWeek={byWeek} byMixer={byMixer} />;
}
