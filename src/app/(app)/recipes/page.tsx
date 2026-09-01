import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { RecipesView } from "@/components/recipes/recipes-view";

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
    { data: batches },
    { data: suppliers },
  ] = await Promise.all([
    admin
      .from("flavours")
      .select("id, code, name, is_active, current_version_id")
      .order("code"),
    admin
      .from("recipe_versions")
      .select("id, flavour_id, version_no, status, created_at")
      .order("version_no", { ascending: false }),
    admin
      .from("raw_materials")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    admin.from("batches").select("recipe_version_id"),
    admin
      .from("suppliers")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
  ]);

  const batchCountByVersionId = new Map<string, number>();
  for (const b of batches ?? []) {
    batchCountByVersionId.set(
      b.recipe_version_id,
      (batchCountByVersionId.get(b.recipe_version_id) ?? 0) + 1,
    );
  }
  const versionSummaries = (versions ?? []).map((v) => ({
    ...v,
    batchCount: batchCountByVersionId.get(v.id) ?? 0,
  }));

  return (
    <RecipesView
      flavours={flavours ?? []}
      versions={versionSummaries}
      materials={materials ?? []}
      suppliers={suppliers ?? []}
      canCreateVersion={session.role === "admin"}
    />
  );
}
