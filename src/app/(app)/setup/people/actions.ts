"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deactivateUserSchema,
  inviteUserSchema,
  updateUserSchema,
  type InviteUserInput,
  type UpdateUserInput,
} from "@/lib/validation/people";

type ActionResult = { success: true } | { success: false; error: string };

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

async function setDepartmentAssignments(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  role: string,
  departmentIds: string[],
  createdBy: string,
) {
  const { error: deleteError } = await admin
    .from("user_departments")
    .delete()
    .eq("profile_id", profileId);
  if (deleteError) throw new Error(deleteError.message);

  if (role !== "hod" || departmentIds.length === 0) return;

  const { error: insertError } = await admin.from("user_departments").insert(
    departmentIds.map((departmentId) => ({
      profile_id: profileId,
      department_id: departmentId,
      created_by: createdBy,
    })),
  );
  if (insertError) throw new Error(insertError.message);
}

export async function inviteUser(
  input: InviteUserInput,
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Admin access required." };

  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { email, fullName, role, branchId, departmentIds } = parsed.data;

  const admin = createAdminClient();

  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/set-password`;
  const { data: inviteData, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName },
    });
  if (inviteError) return { success: false, error: inviteError.message };

  const userId = inviteData.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    full_name: fullName,
    role,
    branch_id: branchId,
    created_by: session.userId,
  });
  if (profileError) {
    return { success: false, error: profileError.message };
  }

  try {
    await setDepartmentAssignments(
      admin,
      userId,
      role,
      departmentIds,
      session.userId,
    );
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  revalidatePath("/setup/people");
  return { success: true };
}

export async function updateUser(
  input: UpdateUserInput,
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Admin access required." };

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { id, role, branchId, departmentIds } = parsed.data;

  const admin = createAdminClient();

  const { error: updateError } = await admin
    .from("profiles")
    .update({ role, branch_id: branchId })
    .eq("id", id);
  if (updateError) return { success: false, error: updateError.message };

  try {
    await setDepartmentAssignments(
      admin,
      id,
      role,
      departmentIds,
      session.userId,
    );
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  revalidatePath("/setup/people");
  return { success: true };
}

export async function deactivateUser(input: {
  id: string;
}): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Admin access required." };

  const parsed = deactivateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_active: false })
    .eq("id", parsed.data.id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/people");
  return { success: true };
}
