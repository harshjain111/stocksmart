import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { MakeBatchView } from "@/components/mix/make-batch-view";
import { MixerBatchQueueView } from "@/components/mix/mixer-batch-queue-view";

type DepartmentRow = {
  id: string;
  name: string;
  branches: { name: string } | null;
};

export default async function MixPage() {
  const session = await getSession();
  if (!session || !["admin", "senior_mixer", "mixer"].includes(session.role)) {
    redirect("/");
  }

  // A mixer never sees the create-a-batch form — they only work an
  // already-drafted batch, masked (rule 8). Entirely separate view.
  if (session.role === "mixer") {
    return <MixerBatchQueueView />;
  }

  const admin = createAdminClient();

  let departmentsQuery = admin
    .from("departments")
    .select("id, name, branches(name)")
    .eq("can_mix", true)
    .eq("is_active", true);

  if (session.role !== "admin" && session.branchId) {
    departmentsQuery = departmentsQuery.eq("branch_id", session.branchId);
  }

  const [{ data: flavours }, { data: versions }, { data: departments }] =
    await Promise.all([
      admin
        .from("flavours")
        .select("id, code, name, current_version_id")
        .eq("is_active", true)
        .order("name"),
      admin
        .from("recipe_versions")
        .select("id, flavour_id, version_no, status")
        .order("version_no", { ascending: false }),
      departmentsQuery.order("name").returns<DepartmentRow[]>(),
    ]);

  return (
    <MakeBatchView
      flavours={flavours ?? []}
      versions={versions ?? []}
      departments={(departments ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        branchName: d.branches?.name ?? "",
      }))}
    />
  );
}
