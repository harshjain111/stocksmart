import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessSetupTab } from "@/lib/setup-tabs";
import { RecipeAccessView } from "@/components/setup/recipe-access-view";

type AuditRow = {
  id: string;
  actor_id: string;
  metadata: { flavour_id?: string; version_no?: number } | null;
  created_at: string;
};

export default async function SetupRecipeAccessPage() {
  const session = await getSession();
  if (!session || !canAccessSetupTab(session.role, "/setup/recipe-access")) {
    redirect("/setup");
  }

  // audit_log RLS restricts SELECT to admin already, but this page (like
  // other Setup screens) reads via the admin client for the same reason as
  // recipe_versions/recipe_lines: no need to duplicate that gate here since
  // the page itself is already admin-only.
  const admin = createAdminClient();

  const { data: logs } = await admin
    .from("audit_log")
    .select("id, actor_id, metadata, created_at")
    .eq("action", "recipe_read")
    .order("created_at", { ascending: false })
    .returns<AuditRow[]>();

  const rows = logs ?? [];
  const actorIds = [...new Set(rows.map((r) => r.actor_id))];
  const flavourIds = [
    ...new Set(rows.map((r) => r.metadata?.flavour_id).filter(Boolean)),
  ] as string[];

  const [{ data: profiles }, { data: flavours }] = await Promise.all([
    actorIds.length > 0
      ? admin.from("profiles").select("id, full_name").in("id", actorIds)
      : Promise.resolve({ data: [] }),
    flavourIds.length > 0
      ? admin.from("flavours").select("id, name, code").in("id", flavourIds)
      : Promise.resolve({ data: [] }),
  ]);

  const nameByActorId = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name]),
  );
  const flavourById = new Map(
    (flavours ?? []).map((f) => [f.id, { name: f.name, code: f.code }]),
  );

  const accessLog = rows.map((r) => {
    const flavour = r.metadata?.flavour_id
      ? flavourById.get(r.metadata.flavour_id)
      : undefined;
    return {
      id: r.id,
      userName: nameByActorId.get(r.actor_id) ?? "Unknown",
      flavourName: flavour?.name ?? "Unknown flavour",
      flavourCode: flavour?.code ?? null,
      versionNo: r.metadata?.version_no ?? null,
      createdAt: r.created_at,
    };
  });

  return <RecipeAccessView accessLog={accessLog} />;
}
