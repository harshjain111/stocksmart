"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createRecipeVersionSchema,
  type CreateRecipeVersionInput,
} from "@/lib/validation/recipes";

type ActionResult = { success: true } | { success: false; error: string };

type VersionDetailResult =
  | {
      success: true;
      data: {
        note: string;
        createdAt: string;
        createdByName: string;
        wastagePct: number;
        lines: {
          rawMaterialId: string;
          materialName: string;
          percentage: number;
        }[];
      };
    }
  | { success: false; error: string };

async function requireRecipeAccess() {
  const session = await getSession();
  if (!session || !["admin", "senior_mixer"].includes(session.role)) {
    return null;
  }
  return session;
}

export async function getVersionDetail(
  versionId: string,
): Promise<VersionDetailResult> {
  const session = await requireRecipeAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(versionId);
  if (!parsed.success) return { success: false, error: "Invalid version." };

  const admin = createAdminClient();

  const { data: version, error: versionError } = await admin
    .from("recipe_versions")
    .select("note, created_at, created_by, flavour_id, wastage_pct")
    .eq("id", parsed.data)
    .single();
  if (versionError || !version) {
    return { success: false, error: "Version not found." };
  }

  const { data: lines, error: linesError } = await admin
    .from("recipe_lines")
    .select("percentage, raw_material_id, raw_materials(name)")
    .eq("recipe_version_id", parsed.data)
    .order("percentage", { ascending: false });
  if (linesError) return { success: false, error: linesError.message };

  let createdByName = "Unknown";
  if (version.created_by) {
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", version.created_by)
      .single();
    if (profile) createdByName = profile.full_name;
  }

  return {
    success: true,
    data: {
      note: version.note,
      createdAt: version.created_at,
      createdByName,
      wastagePct: Number(version.wastage_pct),
      lines: (lines ?? []).map((l) => ({
        rawMaterialId: l.raw_material_id,
        materialName:
          (l.raw_materials as unknown as { name: string } | null)?.name ??
          "Unknown material",
        percentage: Number(l.percentage),
      })),
    },
  };
}

// Calls create_recipe_version() via the per-request client so auth.uid()
// resolves to the real signed-in user inside the SECURITY DEFINER function
// (the admin check, created_by, and audit_log actor_id all depend on it —
// the service-role client has no session and would resolve to nobody).
export async function createRecipeVersion(
  input: CreateRecipeVersionInput,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return { success: false, error: "Only admin can create a new version." };
  }

  const parsed = createRecipeVersionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_recipe_version", {
    p_flavour_id: parsed.data.flavourId,
    p_wastage_pct: parsed.data.wastagePct,
    p_note: parsed.data.note,
    p_lines: parsed.data.lines.map((l) => ({
      raw_material_id: l.rawMaterialId,
      percentage: l.percentage,
    })),
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/recipes");
  return { success: true };
}
