"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  createFlavourSchema,
  updateFlavourSchema,
  type CreateFlavourInput,
  type UpdateFlavourInput,
} from "@/lib/validation/flavours";

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

async function requireFlavourAccess() {
  const session = await getSession();
  if (!session || !["admin", "purchase_manager"].includes(session.role)) {
    return null;
  }
  return session;
}

// Creating a flavour here never creates a recipe — that happens on the
// Recipes screen (phase 2), which sets current_version_id once a version exists.
export async function createFlavour(
  input: CreateFlavourInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireFlavourAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = createFlavourSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { data: flavour, error } = await supabase
    .from("flavours")
    .insert({
      name: parsed.data.name,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !flavour) {
    return { success: false, error: error?.message ?? "Could not create flavour." };
  }

  revalidatePath("/setup/materials");
  revalidatePath("/recipes");
  return { success: true, data: { id: flavour.id } };
}

export async function updateFlavour(
  input: UpdateFlavourInput,
): Promise<ActionResult> {
  const session = await requireFlavourAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = updateFlavourSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("flavours")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/materials");
  return { success: true };
}
