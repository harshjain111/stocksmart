"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessSetupTab } from "@/lib/setup-tabs";

const entrySchema = z.object({
  itemType: z.enum(["raw", "flavour"]),
  itemId: z.uuid(),
  parQtyG: z.coerce.number().int().min(0),
});

const saveParLevelsSchema = z.object({
  departmentId: z.uuid(),
  entries: z.array(entrySchema),
});

type ActionResult = { success: true } | { success: false; error: string };

export async function saveParLevels(
  input: z.infer<typeof saveParLevelsSchema>,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !canAccessSetupTab(session.role, "/setup/par-levels")) {
    return { success: false, error: "Access required." };
  }

  const parsed = saveParLevelsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  if (parsed.data.entries.length === 0) return { success: true };

  const supabase = await createClient();
  const { error } = await supabase.from("par_levels").upsert(
    parsed.data.entries.map((e) => ({
      department_id: parsed.data.departmentId,
      item_type: e.itemType,
      item_id: e.itemId,
      par_qty_g: e.parQtyG,
      created_by: session.userId,
    })),
    { onConflict: "department_id,item_type,item_id" },
  );
  if (error) return { success: false, error: error.message };

  revalidatePath("/setup/par-levels");
  revalidatePath("/stock");
  return { success: true };
}
