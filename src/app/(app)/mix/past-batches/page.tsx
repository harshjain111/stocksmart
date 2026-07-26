import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PastBatchesView } from "@/components/mix/past-batches-view";

type BatchRow = {
  id: string;
  batch_no: string;
  output_g: number;
  mixed_by: string | null;
  mixed_at: string | null;
  rating: number | null;
  feedback: string | null;
  flavours: { name: string } | null;
  recipe_versions: { version_no: number } | null;
};

type VersionRow = {
  id: string;
  version_no: number;
  status: "current" | "archived";
  note: string;
  flavours: { name: string } | null;
};

export default async function PastBatchesPage() {
  const session = await getSession();
  if (!session || !["admin", "senior_mixer"].includes(session.role)) {
    redirect("/");
  }

  const admin = createAdminClient();

  let batchesQuery = admin
    .from("batches")
    .select(
      "id, batch_no, output_g, mixed_by, mixed_at, rating, feedback, flavours(name), recipe_versions(version_no)",
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

  const batchRows = (batches ?? []).map((b) => ({
    id: b.id,
    batchNo: b.batch_no,
    flavourName: b.flavours?.name ?? "Unknown flavour",
    versionNo: b.recipe_versions?.version_no ?? null,
    outputG: b.output_g,
    mixedByName: b.mixed_by ? (nameById.get(b.mixed_by) ?? "Unknown") : "—",
    mixedAt: b.mixed_at,
    rating: b.rating,
    feedback: b.feedback,
  }));

  // flavours(name) is ambiguous here without the explicit FK name — flavours
  // has two relationships to recipe_versions (its own flavour_id, and the
  // reverse current_version_id pointer), so PostgREST can't infer which one
  // to embed through on its own.
  const { data: versions, error: versionsError } = await admin
    .from("recipe_versions")
    .select(
      "id, version_no, status, note, flavours!recipe_versions_flavour_id_fkey(name)",
    )
    .order("version_no", { ascending: false })
    .returns<VersionRow[]>();
  if (versionsError)
    console.error("Failed to load versions:", versionsError.message);

  let statsQuery = admin
    .from("batches")
    .select("recipe_version_id, rating")
    .eq("status", "confirmed");
  if (session.role !== "admin" && session.branchId) {
    statsQuery = statsQuery.eq("branch_id", session.branchId);
  }
  const { data: statsRows } = await statsQuery;

  const statsByVersion = new Map<
    string,
    { count: number; ratingSum: number; ratingCount: number }
  >();
  for (const row of statsRows ?? []) {
    const s = statsByVersion.get(row.recipe_version_id) ?? {
      count: 0,
      ratingSum: 0,
      ratingCount: 0,
    };
    s.count += 1;
    if (row.rating != null) {
      s.ratingSum += row.rating;
      s.ratingCount += 1;
    }
    statsByVersion.set(row.recipe_version_id, s);
  }

  const scoreboard = (versions ?? []).map((v) => {
    const s = statsByVersion.get(v.id) ?? {
      count: 0,
      ratingSum: 0,
      ratingCount: 0,
    };
    return {
      id: v.id,
      flavourName: v.flavours?.name ?? "Unknown flavour",
      versionNo: v.version_no,
      status: v.status,
      note: v.note,
      batchCount: s.count,
      avgRating: s.ratingCount > 0 ? s.ratingSum / s.ratingCount : null,
    };
  });

  return <PastBatchesView batches={batchRows} scoreboard={scoreboard} />;
}
