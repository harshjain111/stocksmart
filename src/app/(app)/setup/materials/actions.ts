"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  addSupplierRateSchema,
  createMaterialSchema,
  updateMaterialSchema,
  type AddSupplierRateInput,
  type CreateMaterialInput,
  type UpdateMaterialInput,
} from "@/lib/validation/materials";

type ActionResult = { success: true } | { success: false; error: string };

async function requireMaterialAccess() {
  const session = await getSession();
  if (!session || !["admin", "purchase_manager"].includes(session.role)) {
    return null;
  }
  return session;
}

export async function createMaterial(
  input: CreateMaterialInput,
): Promise<ActionResult> {
  const session = await requireMaterialAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = createMaterialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("raw_materials").insert({
    name: parsed.data.name,
    default_supplier_id: parsed.data.defaultSupplierId,
    created_by: session.userId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/materials");
  return { success: true };
}

export async function updateMaterial(
  input: UpdateMaterialInput,
): Promise<ActionResult> {
  const session = await requireMaterialAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = updateMaterialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("raw_materials")
    .update({
      name: parsed.data.name,
      default_supplier_id: parsed.data.defaultSupplierId,
    })
    .eq("id", parsed.data.id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/materials");
  return { success: true };
}

export async function addSupplierRate(
  input: AddSupplierRateInput,
): Promise<ActionResult> {
  const session = await requireMaterialAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = addSupplierRateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("supplier_rates").insert({
    raw_material_id: parsed.data.rawMaterialId,
    supplier_id: parsed.data.supplierId,
    rate: parsed.data.rate,
    source: "manual",
    created_by: session.userId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/materials");
  return { success: true };
}
