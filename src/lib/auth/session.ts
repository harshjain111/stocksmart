import "server-only";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type UserRole =
  | "admin"
  | "branch_manager"
  | "store_manager"
  | "purchase_manager"
  | "hod"
  | "senior_mixer"
  | "mixer";

export type DepartmentSummary = {
  id: string;
  name: string;
  branchId: string;
};

export type Session = {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  departments: DepartmentSummary[];
};

type ProfileRow = {
  full_name: string;
  role: UserRole;
  is_active: boolean;
  branch_id: string | null;
  branches: { name: string } | null;
};

type UserDepartmentRow = {
  departments: { id: string; name: string; branch_id: string } | null;
};

/**
 * Loads "who am I" for the current request. RLS on profiles/departments
 * isn't written until prompt 1.6, so this bootstrap read uses the
 * service-role client scoped strictly to the verified session's own
 * user id (never client-controlled input) — everything else in the app
 * goes through the regular per-request client and is subject to RLS.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();

  const [{ data: profile }, { data: userDepartments }] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name, role, is_active, branch_id, branches(name)")
      .eq("id", user.id)
      .single<ProfileRow>(),
    admin
      .from("user_departments")
      .select("departments(id, name, branch_id)")
      .eq("profile_id", user.id)
      .returns<UserDepartmentRow[]>(),
  ]);

  if (!profile || !profile.is_active) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile.full_name,
    role: profile.role,
    branchId: profile.branch_id,
    branchName: profile.branches?.name ?? null,
    departments: (userDepartments ?? [])
      .map((ud) => ud.departments)
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => ({ id: d.id, name: d.name, branchId: d.branch_id })),
  };
}
