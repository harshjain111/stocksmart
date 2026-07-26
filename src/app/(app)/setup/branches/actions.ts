"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  archiveDepartmentSchema,
  createBranchSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  type CreateBranchInput,
  type CreateDepartmentInput,
  type UpdateDepartmentInput,
} from "@/lib/validation/branches";

type ActionResult = { success: true } | { success: false; error: string };

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return null;
  }
  return session;
}

export async function createBranch(
  input: CreateBranchInput,
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Admin access required." };

  const parsed = createBranchSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("branches").insert({
    name: parsed.data.name,
    is_hq: parsed.data.isHq,
    created_by: session.userId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/branches");
  return { success: true };
}

export async function createDepartment(
  input: CreateDepartmentInput,
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Admin access required." };

  const parsed = createDepartmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("departments").insert({
    branch_id: parsed.data.branchId,
    name: parsed.data.name,
    type: parsed.data.type,
    holds_raw: parsed.data.holdsRaw,
    holds_mixed: parsed.data.holdsMixed,
    can_mix: parsed.data.canMix,
    hod_id: parsed.data.hodId,
    created_by: session.userId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/branches");
  return { success: true };
}

export async function updateDepartment(
  input: UpdateDepartmentInput,
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Admin access required." };

  const parsed = updateDepartmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("departments")
    .update({
      branch_id: parsed.data.branchId,
      name: parsed.data.name,
      type: parsed.data.type,
      holds_raw: parsed.data.holdsRaw,
      holds_mixed: parsed.data.holdsMixed,
      can_mix: parsed.data.canMix,
      hod_id: parsed.data.hodId,
    })
    .eq("id", parsed.data.id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/branches");
  return { success: true };
}

/**
 * Departments can only be archived with zero stock — but stock_balances
 * doesn't exist until phase 3 (3.2). This check is a placeholder that
 * always passes; wire up the real balance lookup once that table lands.
 */
async function hasZeroStock(departmentId: string): Promise<boolean> {
  void departmentId;
  return true;
}

export async function archiveDepartment(input: {
  id: string;
}): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Admin access required." };

  const parsed = archiveDepartmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  if (!(await hasZeroStock(parsed.data.id))) {
    return {
      success: false,
      error: "This department still holds stock and can't be archived.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("departments")
    .update({ is_active: false })
    .eq("id", parsed.data.id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/branches");
  return { success: true };
}
