import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessSetupTab } from "@/lib/setup-tabs";
import { BranchesDepartmentsView } from "@/components/setup/branches-departments-view";

export default async function SetupBranchesPage() {
  const session = await getSession();
  if (!session || !canAccessSetupTab(session.role, "/setup/branches")) {
    redirect("/setup");
  }

  const supabase = await createClient();

  const [{ data: branches }, { data: departments }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("branches")
        .select("id, name, is_hq, is_active")
        .order("is_hq", { ascending: false })
        .order("name"),
      supabase
        .from("departments")
        .select(
          "id, branch_id, name, type, holds_raw, holds_mixed, can_mix, hod_id, is_active",
        )
        .order("name"),
      supabase
        .from("profiles")
        .select("id, full_name, branch_id")
        .eq("is_active", true)
        .order("full_name"),
    ]);

  return (
    <BranchesDepartmentsView
      branches={branches ?? []}
      departments={departments ?? []}
      profiles={profiles ?? []}
    />
  );
}
