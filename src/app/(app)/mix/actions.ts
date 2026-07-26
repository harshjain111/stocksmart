"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createDraftBatchSchema,
  type CreateDraftBatchInput,
} from "@/lib/validation/batches";
import {
  fetchMaskedBatchCard,
  type MaskedBatchCard,
} from "@/lib/mix/masked-batch-card";
import { fetchOpsBatchCard, type OpsBatchCard } from "@/lib/mix/ops-batch-card";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

type VersionForBatch = {
  versionNo: number;
  status: "current" | "archived";
  wastagePct: number;
  lines: {
    rawMaterialId: string;
    code: string | null;
    name: string;
    percentage: number;
  }[];
};

// Picking a flavour/version and drafting a new batch (2.8) stays
// admin/senior_mixer only — a mixer works an already-drafted batch (2.9),
// never creates one from scratch.
async function requireMixAccess() {
  const session = await getSession();
  if (!session || !["admin", "senior_mixer"].includes(session.role)) {
    return null;
  }
  return session;
}

async function requireMixerAccess() {
  const session = await getSession();
  if (!session || session.role !== "mixer") return null;
  return session;
}

export async function getRecipeVersionForBatch(
  versionId: string,
): Promise<ActionResult<VersionForBatch>> {
  const session = await requireMixAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(versionId);
  if (!parsed.success) return { success: false, error: "Invalid version." };

  const admin = createAdminClient();

  const { data: version, error: versionError } = await admin
    .from("recipe_versions")
    .select("version_no, status, wastage_pct, flavour_id")
    .eq("id", parsed.data)
    .single();
  if (versionError || !version) {
    return { success: false, error: "Version not found." };
  }

  const { data: lines, error: linesError } = await admin
    .from("recipe_lines")
    .select("raw_material_id, percentage, raw_materials(code, name)")
    .eq("recipe_version_id", parsed.data)
    .order("percentage", { ascending: false });
  if (linesError) return { success: false, error: linesError.message };

  // Picking a version to build a batch card is a read of the recipe's
  // lines just as much as viewing it on the Recipes screen (rule 10).
  const supabase = await createClient();
  const { error: logError } = await supabase.rpc("log_audit_event", {
    p_action: "recipe_read",
    p_entity_type: "recipe_version",
    p_entity_id: parsed.data,
    p_metadata: {
      flavour_id: version.flavour_id,
      version_no: version.version_no,
    },
  });
  if (logError)
    console.error("Failed to log recipe_read audit event:", logError.message);

  return {
    success: true,
    data: {
      versionNo: version.version_no,
      status: version.status,
      wastagePct: Number(version.wastage_pct),
      lines: (lines ?? []).map((l) => ({
        rawMaterialId: l.raw_material_id,
        code:
          (
            l.raw_materials as unknown as {
              code: string | null;
              name: string;
            } | null
          )?.code ?? null,
        name:
          (
            l.raw_materials as unknown as {
              code: string | null;
              name: string;
            } | null
          )?.name ?? "Unknown material",
        percentage: Number(l.percentage),
      })),
    },
  };
}

// Creates the draft batch — the plan for what's about to be mixed. Actual
// weighing, locking and stock movements happen at confirmation (2.10); this
// only records the plan. Re-fetches the version/lines server-side rather
// than trusting the client's copy, so the snapshot always reflects the real
// recipe regardless of what the browser sent.
export async function createDraftBatch(
  input: CreateDraftBatchInput,
): Promise<ActionResult<{ batchNo: string }>> {
  const session = await requireMixAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = createDraftBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { flavourId, recipeVersionId, departmentId, outputG } = parsed.data;

  const admin = createAdminClient();

  const { data: version, error: versionError } = await admin
    .from("recipe_versions")
    .select("wastage_pct, flavour_id, version_no")
    .eq("id", recipeVersionId)
    .single();
  if (versionError || !version || version.flavour_id !== flavourId) {
    return {
      success: false,
      error: "Recipe version not found for this flavour.",
    };
  }

  const { data: lines, error: linesError } = await admin
    .from("recipe_lines")
    .select("raw_material_id, percentage, raw_materials(code, name)")
    .eq("recipe_version_id", recipeVersionId);
  if (linesError || !lines || lines.length === 0) {
    return { success: false, error: "This recipe version has no lines." };
  }

  const { data: department, error: departmentError } = await admin
    .from("departments")
    .select("branch_id, can_mix")
    .eq("id", departmentId)
    .single();
  if (departmentError || !department || !department.can_mix) {
    return { success: false, error: "Not a valid mixing department." };
  }

  const wastagePct = Number(version.wastage_pct);
  const wastageMultiplier = 1 + wastagePct / 100;

  const snapshotLines = lines.map((l) => {
    const material = l.raw_materials as unknown as {
      code: string | null;
      name: string;
    } | null;
    const plannedG = Math.round(
      outputG * (Number(l.percentage) / 100) * wastageMultiplier,
    );
    return {
      rawMaterialId: l.raw_material_id,
      code: material?.code ?? null,
      name: material?.name ?? "Unknown material",
      percentage: Number(l.percentage),
      plannedG,
    };
  });

  const supabase = await createClient();

  const { error: logError } = await supabase.rpc("log_audit_event", {
    p_action: "recipe_read",
    p_entity_type: "recipe_version",
    p_entity_id: recipeVersionId,
    p_metadata: { flavour_id: flavourId, version_no: version.version_no },
  });
  if (logError)
    console.error("Failed to log recipe_read audit event:", logError.message);

  const { data: batchNoRow, error: batchNoError } = await supabase.rpc(
    "next_doc_no",
    { p_doc_type: "B", p_branch_id: department.branch_id },
  );
  if (batchNoError || !batchNoRow) {
    return {
      success: false,
      error: batchNoError?.message ?? "Could not generate batch number.",
    };
  }

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .insert({
      batch_no: batchNoRow,
      branch_id: department.branch_id,
      flavour_id: flavourId,
      recipe_version_id: recipeVersionId,
      recipe_snapshot: { wastagePct, lines: snapshotLines },
      output_g: outputG,
      department_id: departmentId,
      status: "draft",
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (batchError || !batch) {
    return {
      success: false,
      error: batchError?.message ?? "Could not create batch.",
    };
  }

  const { error: consumptionError } = await supabase
    .from("batch_consumption")
    .insert(
      snapshotLines.map((l) => ({
        batch_id: batch.id,
        raw_material_id: l.rawMaterialId,
        planned_g: l.plannedG,
      })),
    );
  if (consumptionError) {
    return { success: false, error: consumptionError.message };
  }

  revalidatePath("/recipes");
  return { success: true, data: { batchNo: batchNoRow } };
}

type DraftBatchSummary = {
  id: string;
  batchNo: string;
  flavourName: string;
  outputG: number;
  createdAt: string;
};

async function listDraftBatchesForBranch(
  branchId: string,
): Promise<ActionResult<DraftBatchSummary[]>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("batches")
    .select("id, batch_no, output_g, created_at, flavours(name)")
    .eq("branch_id", branchId)
    .eq("status", "draft")
    .order("created_at", { ascending: false });
  if (error) return { success: false, error: error.message };

  return {
    success: true,
    data: (data ?? []).map((b) => ({
      id: b.id,
      batchNo: b.batch_no,
      flavourName:
        (b.flavours as unknown as { name: string } | null)?.name ??
        "Unknown flavour",
      outputG: b.output_g,
      createdAt: b.created_at,
    })),
  };
}

// Draft batches at the mixer's own branch — there's no formal per-mixer
// assignment yet, so this is the whole branch's queue rather than a
// personal one. Only draft batches: once confirmed, a batch is history,
// not something waiting to be mixed.
export async function listDraftBatchesForMixer(): Promise<
  ActionResult<DraftBatchSummary[]>
> {
  const session = await requireMixerAccess();
  if (!session || !session.branchId) {
    return { success: false, error: "Access required." };
  }
  return listDraftBatchesForBranch(session.branchId);
}

export async function getMaskedBatchCard(
  batchId: string,
): Promise<ActionResult<MaskedBatchCard>> {
  const session = await requireMixerAccess();
  if (!session || !session.branchId) {
    return { success: false, error: "Access required." };
  }

  const parsed = z.uuid().safeParse(batchId);
  if (!parsed.success) return { success: false, error: "Invalid batch." };

  const admin = createAdminClient();
  return fetchMaskedBatchCard(admin, parsed.data, session.branchId);
}

// Same draft queue as the mixer's, unmasked — admin/senior_mixer already
// have real recipe access, so there's nothing to strip.
export async function listDraftBatchesForOps(): Promise<
  ActionResult<DraftBatchSummary[]>
> {
  const session = await requireMixAccess();
  if (!session || !session.branchId) {
    return { success: false, error: "Access required." };
  }
  return listDraftBatchesForBranch(session.branchId);
}

export async function getOpsBatchCard(
  batchId: string,
): Promise<ActionResult<OpsBatchCard>> {
  const session = await requireMixAccess();
  if (!session || !session.branchId) {
    return { success: false, error: "Access required." };
  }

  const parsed = z.uuid().safeParse(batchId);
  if (!parsed.success) return { success: false, error: "Invalid batch." };

  const admin = createAdminClient();
  return fetchOpsBatchCard(admin, parsed.data, session.branchId);
}

// Confirmation itself (2.10): captures actual weights (defaulting to
// planned for any component not listed), posts batch_consume/batch_produce
// movements and locks the batch — all inside confirm_batch(), one
// SECURITY DEFINER function, so it's fully atomic. Shared by both the
// masked (mixer) and full-detail (admin/senior_mixer) cards — the RPC
// itself re-checks the caller's role and branch, so this wrapper only
// needs to gate "signed in as a role that has a Mix screen at all".
export async function confirmBatch(
  batchId: string,
  actualGrams: { rawMaterialId: string; actualG: number }[],
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getSession();
  if (!session || !["admin", "senior_mixer", "mixer"].includes(session.role)) {
    return { success: false, error: "Access required." };
  }

  const parsedId = z.uuid().safeParse(batchId);
  if (!parsedId.success) return { success: false, error: "Invalid batch." };

  const parsedGrams = z
    .array(
      z.object({
        rawMaterialId: z.uuid(),
        actualG: z.coerce.number().int().nonnegative(),
      }),
    )
    .safeParse(actualGrams);
  if (!parsedGrams.success) {
    return { success: false, error: "Invalid actual weights." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_batch", {
    p_batch_id: parsedId.data,
    p_actual_grams: parsedGrams.data.map((g) => ({
      rawMaterialId: g.rawMaterialId,
      actualG: g.actualG,
    })),
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/recipes");
  return { success: true };
}

// Rating is one of the three fields the 2.7 immutability trigger leaves
// open even after confirmation (rating/feedback/deviation_note), so this
// is a plain update through the per-request client — batches_update RLS
// (admin/branch_manager/senior_mixer, own branch) is the real gate here,
// not this wrapper.
export async function rateBatch(
  batchId: string,
  rating: number,
  feedback: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await requireMixAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsedId = z.uuid().safeParse(batchId);
  if (!parsedId.success) return { success: false, error: "Invalid batch." };

  const parsedRating = z.coerce.number().int().min(1).max(5).safeParse(rating);
  if (!parsedRating.success) {
    return { success: false, error: "Rating must be between 1 and 5." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("batches")
    .update({
      rating: parsedRating.data,
      feedback: feedback.trim() || null,
    })
    .eq("id", parsedId.data)
    .eq("status", "confirmed");
  if (error) return { success: false, error: error.message };

  revalidatePath("/mix/past-batches");
  return { success: true };
}
