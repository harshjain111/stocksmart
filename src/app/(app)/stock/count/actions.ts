"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

async function requireCountAccess() {
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager", "hod"].includes(session.role)
  ) {
    return null;
  }
  return session;
}

async function canAccessDepartment(
  session: NonNullable<Awaited<ReturnType<typeof requireCountAccess>>>,
  departmentId: string,
): Promise<boolean> {
  if (session.role === "admin") return true;
  const admin = createAdminClient();
  const { data: department } = await admin
    .from("departments")
    .select("branch_id")
    .eq("id", departmentId)
    .single();
  if (!department) return false;

  if (session.role === "hod") {
    return session.departments.some((d) => d.id === departmentId);
  }
  return department.branch_id === session.branchId;
}

type CountLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  systemQtyG: number;
  countedQtyG: number | null;
  reason: string | null;
};

type CountSheet = {
  countId: string;
  countNo: string;
  status: "draft" | "submitted" | "approved";
  lines: CountLine[];
};

async function loadSheet(countId: string): Promise<CountSheet> {
  const admin = createAdminClient();

  const { data: count } = await admin
    .from("stock_counts")
    .select("id, count_no, status")
    .eq("id", countId)
    .single();

  const { data: lines } = await admin
    .from("stock_count_lines")
    .select("id, item_type, item_id, system_qty_g, counted_qty_g, reason")
    .eq("count_id", countId)
    .order("created_at", { ascending: true });

  const rawIds = (lines ?? [])
    .filter((l) => l.item_type === "raw")
    .map((l) => l.item_id);
  const flavourIds = (lines ?? [])
    .filter((l) => l.item_type === "flavour")
    .map((l) => l.item_id);

  const [{ data: rawMaterials }, { data: flavours }] = await Promise.all([
    rawIds.length > 0
      ? admin.from("raw_materials").select("id, code, name").in("id", rawIds)
      : Promise.resolve({ data: [] }),
    flavourIds.length > 0
      ? admin.from("flavours").select("id, code, name").in("id", flavourIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map(
    [...(rawMaterials ?? []), ...(flavours ?? [])].map((m) => [
      m.id,
      { name: m.name, code: m.code },
    ]),
  );

  return {
    countId: count!.id,
    countNo: count!.count_no,
    status: count!.status,
    lines: (lines ?? []).map((l) => ({
      id: l.id,
      itemType: l.item_type,
      itemId: l.item_id,
      name: nameById.get(l.item_id)?.name ?? "Unknown item",
      code: nameById.get(l.item_id)?.code ?? null,
      systemQtyG: l.system_qty_g,
      countedQtyG: l.counted_qty_g,
      reason: l.reason,
    })),
  };
}

// One active count per department at a time — draft (editable) or
// submitted (awaiting approval). If one exists, resume/show it rather than
// letting a fresh generate spawn a duplicate.
export async function getActiveCountForDepartment(
  departmentId: string,
): Promise<ActionResult<CountSheet | null>> {
  const session = await requireCountAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(departmentId);
  if (!parsed.success) return { success: false, error: "Invalid department." };
  if (!(await canAccessDepartment(session, parsed.data))) {
    return { success: false, error: "Access required." };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("stock_counts")
    .select("id")
    .eq("department_id", parsed.data)
    .in("status", ["draft", "submitted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) return { success: true, data: null };
  return { success: true, data: await loadSheet(existing.id) };
}

export async function generateCountSheet(
  departmentId: string,
  countRaw: boolean,
  countFlavour: boolean,
): Promise<ActionResult<CountSheet>> {
  const session = await requireCountAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(departmentId);
  if (!parsed.success) return { success: false, error: "Invalid department." };
  if (!(await canAccessDepartment(session, parsed.data))) {
    return { success: false, error: "Access required." };
  }
  if (!countRaw && !countFlavour) {
    return {
      success: false,
      error: "Pick at least one of raw materials or flavours.",
    };
  }

  const admin = createAdminClient();

  const { data: department } = await admin
    .from("departments")
    .select("branch_id, holds_raw, holds_mixed")
    .eq("id", parsed.data)
    .single();
  if (!department) return { success: false, error: "Department not found." };
  if (countRaw && !department.holds_raw) {
    return {
      success: false,
      error: "This department doesn't hold raw materials.",
    };
  }
  if (countFlavour && !department.holds_mixed) {
    return {
      success: false,
      error: "This department doesn't hold mixed flavours.",
    };
  }

  const { data: existing } = await admin
    .from("stock_counts")
    .select("id")
    .eq("department_id", parsed.data)
    .eq("status", "draft")
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      success: false,
      error:
        "A draft count already exists for this department — resume it instead.",
    };
  }

  const itemTypes: ("raw" | "flavour")[] = [
    ...(countRaw ? (["raw"] as const) : []),
    ...(countFlavour ? (["flavour"] as const) : []),
  ];

  const { data: balances } = await admin
    .from("stock_balances")
    .select("item_type, item_id, qty_g")
    .eq("department_id", parsed.data)
    .in("item_type", itemTypes);

  const [{ data: rawMaterials }, { data: flavours }] = await Promise.all([
    countRaw
      ? admin.from("raw_materials").select("id").eq("is_active", true)
      : Promise.resolve({ data: [] }),
    countFlavour
      ? admin.from("flavours").select("id").eq("is_active", true)
      : Promise.resolve({ data: [] }),
  ]);

  const balanceByKey = new Map(
    (balances ?? []).map((b) => [`${b.item_type}|${b.item_id}`, b.qty_g]),
  );

  const items = [
    ...(rawMaterials ?? []).map((m) => ({
      itemType: "raw" as const,
      itemId: m.id,
    })),
    ...(flavours ?? []).map((f) => ({
      itemType: "flavour" as const,
      itemId: f.id,
    })),
  ];
  if (items.length === 0) {
    return {
      success: false,
      error: "No active raw materials or flavours to count.",
    };
  }

  const supabase = await createClient();

  const { data: countNoRow, error: countNoError } = await supabase.rpc(
    "next_doc_no",
    {
      p_doc_type: "CNT",
      p_branch_id: department.branch_id,
    },
  );
  if (countNoError || !countNoRow) {
    return {
      success: false,
      error: countNoError?.message ?? "Could not generate count number.",
    };
  }

  const { data: count, error: countError } = await supabase
    .from("stock_counts")
    .insert({
      count_no: countNoRow,
      branch_id: department.branch_id,
      department_id: parsed.data,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (countError || !count) {
    return {
      success: false,
      error: countError?.message ?? "Could not create count.",
    };
  }

  const { error: linesError } = await supabase.from("stock_count_lines").insert(
    items.map((item) => ({
      count_id: count.id,
      item_type: item.itemType,
      item_id: item.itemId,
      system_qty_g: balanceByKey.get(`${item.itemType}|${item.itemId}`) ?? 0,
    })),
  );
  if (linesError) return { success: false, error: linesError.message };

  revalidatePath("/stock/count");
  return { success: true, data: await loadSheet(count.id) };
}

export async function updateCountLine(
  lineId: string,
  countedQtyG: number | null,
  reason: string,
): Promise<ActionResult<null>> {
  const session = await requireCountAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsedId = z.uuid().safeParse(lineId);
  if (!parsedId.success) return { success: false, error: "Invalid line." };
  const parsedQty = z.coerce
    .number()
    .int()
    .min(0)
    .nullable()
    .safeParse(countedQtyG);
  if (!parsedQty.success) return { success: false, error: "Invalid quantity." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("stock_count_lines")
    .update({ counted_qty_g: parsedQty.data, reason: reason.trim() || null })
    .eq("id", parsedId.data);
  if (error) return { success: false, error: error.message };

  return { success: true, data: null };
}

// Any line with a real difference (counted set and not equal to system)
// needs a reason before the count can be submitted — validated here, not
// just in the UI (rule 8: UI hiding/disabling isn't access control).
export async function submitCount(
  countId: string,
): Promise<ActionResult<null>> {
  const session = await requireCountAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsed = z.uuid().safeParse(countId);
  if (!parsed.success) return { success: false, error: "Invalid count." };

  const admin = createAdminClient();
  const { data: lines, error: linesError } = await admin
    .from("stock_count_lines")
    .select("system_qty_g, counted_qty_g, reason")
    .eq("count_id", parsed.data)
    .order("created_at", { ascending: true });
  if (linesError) return { success: false, error: linesError.message };

  const missingReason = (lines ?? []).some(
    (l) =>
      l.counted_qty_g != null &&
      l.counted_qty_g !== l.system_qty_g &&
      !l.reason?.trim(),
  );
  if (missingReason) {
    return {
      success: false,
      error: "Every line with a difference needs a reason before submitting.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("stock_counts")
    .update({
      status: "submitted",
      submitted_by: session.userId,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", parsed.data);
  if (error) return { success: false, error: error.message };

  revalidatePath("/stock/count");
  return { success: true, data: null };
}

export async function approveCount(
  countId: string,
): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session || !["admin", "store_manager"].includes(session.role)) {
    return {
      success: false,
      error: "Only admin or store manager can approve a count.",
    };
  }

  const parsed = z.uuid().safeParse(countId);
  if (!parsed.success) return { success: false, error: "Invalid count." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_stock_count", {
    p_count_id: parsed.data,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/stock/count");
  return { success: true, data: null };
}
