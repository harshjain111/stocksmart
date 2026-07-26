import type { SupabaseClient } from "@supabase/supabase-js";

export type OpsBatchCard = {
  batchNo: string;
  flavourName: string;
  outputG: number;
  wastagePct: number;
  lines: {
    rawMaterialId: string;
    code: string | null;
    name: string;
    percentage: number;
    plannedG: number;
    actualG: number | null;
  }[];
};

type OpsBatchCardResult =
  { success: true; data: OpsBatchCard } | { success: false; error: string };

type SnapshotLine = {
  rawMaterialId: string;
  code: string | null;
  name: string;
  percentage: number;
  plannedG: number;
};

// The full-detail batch card for roles that already have real recipe
// access (admin/senior_mixer) — everything comes straight off the batch's
// own recipe_snapshot (frozen at draft time, rule 6) plus batch_consumption
// for actual_g, so this never re-reads recipe_versions/recipe_lines either.
export async function fetchOpsBatchCard(
  admin: SupabaseClient,
  batchId: string,
  branchId: string,
): Promise<OpsBatchCardResult> {
  const { data: batch, error: batchError } = await admin
    .from("batches")
    .select(
      "batch_no, output_g, status, branch_id, recipe_snapshot, flavours(name)",
    )
    .eq("id", batchId)
    .single();
  if (batchError || !batch)
    return { success: false, error: "Batch not found." };
  if (batch.branch_id !== branchId) {
    return { success: false, error: "Batch not found." };
  }
  if (batch.status !== "draft") {
    return { success: false, error: "This batch is no longer a draft." };
  }

  const { data: consumption, error: consumptionError } = await admin
    .from("batch_consumption")
    .select("raw_material_id, actual_g")
    .eq("batch_id", batchId);
  if (consumptionError) {
    return { success: false, error: consumptionError.message };
  }
  const actualByMaterialId = new Map(
    (consumption ?? []).map((c) => [c.raw_material_id, c.actual_g]),
  );

  const snapshot = batch.recipe_snapshot as {
    wastagePct: number;
    lines: SnapshotLine[];
  };

  return {
    success: true,
    data: {
      batchNo: batch.batch_no,
      flavourName:
        (batch.flavours as unknown as { name: string } | null)?.name ??
        "Unknown flavour",
      outputG: batch.output_g,
      wastagePct: snapshot.wastagePct,
      lines: snapshot.lines.map((l) => ({
        ...l,
        actualG: actualByMaterialId.get(l.rawMaterialId) ?? null,
      })),
    },
  };
}
