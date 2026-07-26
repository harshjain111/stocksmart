import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ItemType = "raw" | "flavour";

export type MovementReason =
  | "grn_vendor"
  | "grn_transfer"
  | "dispatch"
  | "batch_consume"
  | "batch_produce"
  | "count_adjust"
  | "transit_loss"
  | "club_sync"
  | "opening";

export type PostMovementInput = {
  departmentId: string;
  itemType: ItemType;
  itemId: string;
  qtyG: number;
  reason: MovementReason;
  refType: string;
  refId: string;
  /** Only for corrections that must be allowed to go negative — defaults to false. */
  allowNegative?: boolean;
};

export type PostMovementResult =
  { success: true; movementId: string } | { success: false; error: string };

// The single function every feature calls to move stock (rule 2 + 3.3).
// A thin, typed wrapper over post_movement() — the SECURITY DEFINER
// Postgres function (2.10) that does the actual enforcement atomically at
// the DB layer: the department must be able to hold the item type, and the
// balance can't go negative unless allowNegative is set. Nothing in the
// codebase should ever insert into stock_movements directly — call this
// instead, from a Server Action, passing the per-request client so
// created_by resolves to the real caller.
export async function postMovement(
  supabase: SupabaseClient,
  input: PostMovementInput,
): Promise<PostMovementResult> {
  const { data, error } = await supabase.rpc("post_movement", {
    p_department_id: input.departmentId,
    p_item_type: input.itemType,
    p_item_id: input.itemId,
    p_qty_g: input.qtyG,
    p_reason: input.reason,
    p_ref_type: input.refType,
    p_ref_id: input.refId,
    p_allow_negative: input.allowNegative ?? false,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, movementId: data as string };
}
