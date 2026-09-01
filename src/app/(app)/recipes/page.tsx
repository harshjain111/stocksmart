import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  RecipesView,
  type FlavourRow,
  type AttentionItem,
} from "@/components/recipes/recipes-view";

const NOT_USED_DAYS = 90;

// recipe_versions/recipe_lines have RLS enabled with zero policies until
// prompt 2.6 adds the real admin+senior_mixer grant, so this page reads via
// the admin client — the actual gate is the role check below. Once 2.6
// lands, switch this to the regular per-request client so RLS is what's
// really enforcing it, not just this page-level guard.
export default async function RecipesPage() {
  const session = await getSession();
  if (!session || !["admin", "senior_mixer"].includes(session.role)) {
    redirect("/");
  }

  const admin = createAdminClient();

  const [
    { data: flavours },
    { data: versions },
    { data: materials },
    { data: allLines },
    { data: batches },
    { data: suppliers },
    { data: profiles },
  ] = await Promise.all([
    admin
      .from("flavours")
      .select("id, code, name, is_active, current_version_id")
      .order("code"),
    admin
      .from("recipe_versions")
      .select(
        "id, flavour_id, version_no, status, created_at, created_by, wastage_pct, note",
      )
      .order("version_no", { ascending: false }),
    admin
      .from("raw_materials")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    admin
      .from("recipe_lines")
      .select("recipe_version_id, percentage, raw_material_id, raw_materials(name)")
      .order("percentage", { ascending: false }),
    admin
      .from("batches")
      .select("id, batch_no, flavour_id, recipe_version_id, output_g, mixed_at, status")
      .eq("status", "confirmed")
      .order("mixed_at", { ascending: false }),
    admin
      .from("suppliers")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    admin.from("profiles").select("id, full_name"),
  ]);

  const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const linesByVersionId = new Map<
    string,
    { rawMaterialId: string; materialName: string; percentage: number }[]
  >();
  for (const l of allLines ?? []) {
    const list = linesByVersionId.get(l.recipe_version_id) ?? [];
    list.push({
      rawMaterialId: l.raw_material_id,
      materialName:
        (l.raw_materials as unknown as { name: string } | null)?.name ??
        "Unknown material",
      percentage: Number(l.percentage),
    });
    linesByVersionId.set(l.recipe_version_id, list);
  }

  const versionsByFlavourId = new Map<string, typeof versions>();
  for (const v of versions ?? []) {
    const list = versionsByFlavourId.get(v.flavour_id) ?? [];
    list.push(v);
    versionsByFlavourId.set(v.flavour_id, list);
  }

  const batchesByFlavourId = new Map<string, typeof batches>();
  const batchCountByVersionId = new Map<string, number>();
  for (const b of batches ?? []) {
    const list = batchesByFlavourId.get(b.flavour_id) ?? [];
    list.push(b);
    batchesByFlavourId.set(b.flavour_id, list);
    batchCountByVersionId.set(
      b.recipe_version_id,
      (batchCountByVersionId.get(b.recipe_version_id) ?? 0) + 1,
    );
  }

  const now = Date.now();
  const attentionItems: AttentionItem[] = [];

  const flavourRows: FlavourRow[] = (flavours ?? []).map((f) => {
    const flavourVersions = versionsByFlavourId.get(f.id) ?? [];
    const currentVersionRow = flavourVersions.find(
      (v) => v.id === f.current_version_id,
    );
    const flavourBatches = (batchesByFlavourId.get(f.id) ?? []).slice();
    const totalBatches = flavourBatches.length;
    const totalProducedG = flavourBatches.reduce((sum, b) => sum + b.output_g, 0);
    const recentBatches = flavourBatches.slice(0, 3).map((b) => ({
      id: b.id,
      batchNo: b.batch_no,
      mixedAt: b.mixed_at,
      outputG: b.output_g,
    }));
    const lastBatchAt = flavourBatches[0]?.mixed_at ?? null;

    const currentVersion = currentVersionRow
      ? {
          id: currentVersionRow.id,
          versionNo: currentVersionRow.version_no,
          wastagePct: Number(currentVersionRow.wastage_pct),
          note: currentVersionRow.note,
          createdAt: currentVersionRow.created_at,
          createdByName: currentVersionRow.created_by
            ? (profileNameById.get(currentVersionRow.created_by) ?? "Unknown")
            : "Unknown",
          lines: linesByVersionId.get(currentVersionRow.id) ?? [],
          batchCount: batchCountByVersionId.get(currentVersionRow.id) ?? 0,
        }
      : null;

    const archivedVersions = flavourVersions
      .filter((v) => v.id !== f.current_version_id)
      .sort((a, b) => b.version_no - a.version_no)
      .map((v) => ({
        id: v.id,
        versionNo: v.version_no,
        createdAt: v.created_at,
        createdByName: v.created_by
          ? (profileNameById.get(v.created_by) ?? "Unknown")
          : "Unknown",
        note: v.note,
        batchCount: batchCountByVersionId.get(v.id) ?? 0,
      }));

    if (f.is_active) {
      if (!currentVersion) {
        attentionItems.push({
          flavourId: f.id,
          flavourName: f.name,
          reason: "No recipe",
        });
      } else if (
        (batchCountByVersionId.get(currentVersion.id) ?? 0) === 0 &&
        flavourVersions.length > 1
      ) {
        attentionItems.push({
          flavourId: f.id,
          flavourName: f.name,
          reason: "New version not used",
        });
      } else if (
        lastBatchAt &&
        (now - new Date(lastBatchAt).getTime()) / (1000 * 60 * 60 * 24) >
          NOT_USED_DAYS
      ) {
        attentionItems.push({
          flavourId: f.id,
          flavourName: f.name,
          reason: `Not used in ${NOT_USED_DAYS} days`,
        });
      }
    }

    return {
      id: f.id,
      code: f.code,
      name: f.name,
      isActive: f.is_active,
      currentVersion,
      archivedVersions,
      totalBatches,
      totalProducedG,
      recentBatches,
      lastBatchAt,
    };
  });

  const activeFlavours = flavourRows.filter((f) => f.isActive);
  const kpis = {
    totalFlavours: activeFlavours.length,
    recipesSet: activeFlavours.filter((f) => f.currentVersion).length,
    noRecipe: activeFlavours.filter((f) => !f.currentVersion).length,
    totalBatches: batches?.length ?? 0,
  };

  // Rule 10: every read of a recipe's formula is logged — this page shows
  // each active flavour's current-version ingredients up front (not behind
  // a click), so every one of those is a read, logged in one batch rather
  // than blocking the page on N sequential round trips. Best-effort: a
  // logging failure shouldn't stop the user seeing recipes they already
  // have access to.
  const supabase = await createClient();
  const readVersions = flavourRows
    .filter((f) => f.isActive && f.currentVersion)
    .map((f) => f.currentVersion!);
  await Promise.all(
    readVersions.map((v) =>
      supabase
        .rpc("log_audit_event", {
          p_action: "recipe_read",
          p_entity_type: "recipe_version",
          p_entity_id: v.id,
          p_metadata: { version_no: v.versionNo },
        })
        .then(({ error }) => {
          if (error) {
            console.error("Failed to log recipe_read audit event:", error.message);
          }
        }),
    ),
  );

  return (
    <RecipesView
      flavours={flavourRows}
      attentionItems={attentionItems}
      kpis={kpis}
      materials={materials ?? []}
      suppliers={suppliers ?? []}
      canCreateVersion={session.role === "admin"}
    />
  );
}
