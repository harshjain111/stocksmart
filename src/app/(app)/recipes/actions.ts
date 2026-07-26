"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

type VersionDetailResult =
  | {
      success: true;
      data: {
        note: string;
        createdAt: string;
        createdByName: string;
        lines: { materialName: string; percentage: number }[];
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
    .select("note, created_at, created_by, flavour_id")
    .eq("id", parsed.data)
    .single();
  if (versionError || !version) {
    return { success: false, error: "Version not found." };
  }

  const { data: lines, error: linesError } = await admin
    .from("recipe_lines")
    .select("percentage, raw_materials(name)")
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
      lines: (lines ?? []).map((l) => ({
        materialName:
          (l.raw_materials as unknown as { name: string } | null)?.name ??
          "Unknown material",
        percentage: Number(l.percentage),
      })),
    },
  };
}
