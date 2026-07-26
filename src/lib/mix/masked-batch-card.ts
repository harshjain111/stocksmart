import type { SupabaseClient } from "@supabase/supabase-js";

export type MaskedBatchCard = {
  batchNo: string;
  flavourName: string;
  outputG: number;
  lines: { rawMaterialId: string; code: string | null; plannedG: number }[];
};

type MaskedBatchCardResult =
  { success: true; data: MaskedBatchCard } | { success: false; error: string };

// The masked batch card (rule 8): a mixer gets component codes and their
// planned weight, nothing else — no material name, no percentage, no
// recipe version number. planned_g is read straight off batch_consumption
// (computed once, server-side, when the batch was drafted in 2.8), so this
// never touches recipe_versions/recipe_lines at all and has no formula
// data to leak in the first place.
//
// Framework-independent (plain SupabaseClient in, plain object out) so it
// can be exercised directly from a test script without a Next.js request
// context — the Server Action in mix/actions.ts is a thin auth wrapper
// around this.
export async function fetchMaskedBatchCard(
  admin: SupabaseClient,
  batchId: string,
  branchId: string,
): Promise<MaskedBatchCardResult> {
  const { data: batch, error: batchError } = await admin
    .from("batches")
    .select("batch_no, output_g, status, branch_id, flavours(name)")
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
    .select("raw_material_id, planned_g, raw_materials(code)")
    .eq("batch_id", batchId);
  if (consumptionError) {
    return { success: false, error: consumptionError.message };
  }

  return {
    success: true,
    data: {
      batchNo: batch.batch_no,
      flavourName:
        (batch.flavours as unknown as { name: string } | null)?.name ??
        "Unknown flavour",
      outputG: batch.output_g,
      lines: (consumption ?? []).map((c) => ({
        rawMaterialId: c.raw_material_id,
        code:
          (c.raw_materials as unknown as { code: string | null } | null)
            ?.code ?? null,
        plannedG: c.planned_g,
      })),
    },
  };
}
