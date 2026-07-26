import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessSetupTab } from "@/lib/setup-tabs";
import { PeopleView } from "@/components/setup/people-view";

export default async function SetupPeoplePage() {
  const session = await getSession();
  if (!session || !canAccessSetupTab(session.role, "/setup/people")) {
    redirect("/setup");
  }

  const supabase = await createClient();

  const [
    { data: profiles },
    { data: branches },
    { data: departments },
    { data: userDepartments },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, branch_id, is_active")
      .order("full_name"),
    supabase.from("branches").select("id, name").order("name"),
    supabase
      .from("departments")
      .select("id, name, branch_id")
      .eq("is_active", true)
      .order("name"),
    supabase.from("user_departments").select("profile_id, department_id"),
  ]);

  const admin = createAdminClient();
  const emailById = new Map<string, string>();
  await Promise.all(
    (profiles ?? []).map(async (p) => {
      const { data } = await admin.auth.admin.getUserById(p.id);
      if (data.user?.email) emailById.set(p.id, data.user.email);
    }),
  );

  const people = (profiles ?? []).map((p) => ({
    ...p,
    email: emailById.get(p.id) ?? "",
    departmentIds: (userDepartments ?? [])
      .filter((ud) => ud.profile_id === p.id)
      .map((ud) => ud.department_id),
  }));

  return (
    <PeopleView
      people={people}
      branches={branches ?? []}
      departments={departments ?? []}
    />
  );
}
