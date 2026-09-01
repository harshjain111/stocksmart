"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  archiveSupplierSchema,
  createSupplierSchema,
  updateSupplierSchema,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from "@/lib/validation/suppliers";

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

async function requireSupplierAccess() {
  const session = await getSession();
  if (!session || !["admin", "purchase_manager"].includes(session.role)) {
    return null;
  }
  return session;
}

export async function createSupplier(
  input: CreateSupplierInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSupplierAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { data: supplier, error } = await supabase
    .from("suppliers")
    .insert({
      name: parsed.data.name,
      area: parsed.data.area || null,
      contact_person: parsed.data.contactPerson || null,
      phone: parsed.data.phone || null,
      gstin: parsed.data.gstin || null,
      notes: parsed.data.notes || null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !supplier) {
    return { success: false, error: error?.message ?? "Could not create supplier." };
  }

  revalidatePath("/setup/suppliers");
  revalidatePath("/setup/materials");
  revalidatePath("/recipes");
  return { success: true, data: { id: supplier.id } };
}

export async function updateSupplier(
  input: UpdateSupplierInput,
): Promise<ActionResult> {
  const session = await requireSupplierAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({
      name: parsed.data.name,
      area: parsed.data.area || null,
      contact_person: parsed.data.contactPerson || null,
      phone: parsed.data.phone || null,
      gstin: parsed.data.gstin || null,
      notes: parsed.data.notes || null,
    })
    .eq("id", parsed.data.id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/suppliers");
  return { success: true };
}

export async function archiveSupplier(input: {
  id: string;
}): Promise<ActionResult> {
  const session = await requireSupplierAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = archiveSupplierSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ is_active: false })
    .eq("id", parsed.data.id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/suppliers");
  return { success: true };
}
