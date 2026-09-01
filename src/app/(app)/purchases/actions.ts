"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeBuyPlan, type BuyEngineInput } from "@/lib/buy/buy-engine";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

async function requireBuyAccess() {
  const session = await getSession();
  if (!session || !can(session.role, "nav:purchases")) return null;
  return session;
}

const manualEntrySchema = z.object({
  itemType: z.enum(["raw", "flavour"]),
  itemId: z.uuid(),
  branchId: z.uuid(),
  qtyG: z.coerce.number().int().positive(),
});

export type ManualEntryInput = z.infer<typeof manualEntrySchema>;

type BuyLineView = {
  rawMaterialId: string;
  rawMaterialName: string;
  rawMaterialCode: string | null;
  neededG: number;
  haveG: number;
  onOrderG: number;
  buyG: number;
};

export type BuyGroupView = {
  key: string;
  supplierId: string | null;
  supplierName: string | null;
  departmentId: string;
  departmentName: string;
  branchId: string;
  lines: BuyLineView[];
};

type WhatToBuyResult = {
  groups: BuyGroupView[];
  issues: string[];
  requisitionLineCount: number;
};

// Every demand source resolves to the branch's own godown (the only
// department per branch with holds_raw = true) — that's "the department
// that will fulfil" per CLAUDE.md's buying logic, regardless of which
// department originated the demand. A club's own shortfall is already
// netted at requisition-decision time (the requisition qty_g *is* the
// shortfall); from here on the only "have" that matters is what the
// godown itself is already sitting on.
export async function godownsByBranch(
  admin: ReturnType<typeof createAdminClient>,
  branchIds: string[],
): Promise<Map<string, { id: string; name: string }>> {
  if (branchIds.length === 0) return new Map();
  const { data } = await admin
    .from("departments")
    .select("id, name, branch_id")
    .in("branch_id", branchIds)
    .eq("holds_raw", true)
    .eq("is_active", true);
  return new Map((data ?? []).map((d) => [d.branch_id, { id: d.id, name: d.name }]));
}

export async function getWhatToBuyData(
  manualEntries: ManualEntryInput[],
  includeParTopUp: boolean,
): Promise<ActionResult<WhatToBuyResult>> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };

  const parsedManual = z.array(manualEntrySchema).safeParse(manualEntries);
  if (!parsedManual.success) {
    return { success: false, error: "Invalid manual entry." };
  }

  const admin = createAdminClient();

  const branchScope =
    session.role === "admin"
      ? (await admin.from("branches").select("id").eq("is_active", true)).data?.map(
          (b) => b.id,
        ) ?? []
      : session.branchId
        ? [session.branchId]
        : [];

  if (branchScope.length === 0) {
    return { success: true, data: { groups: [], issues: [], requisitionLineCount: 0 } };
  }

  const godowns = await godownsByBranch(admin, branchScope);
  const branchesMissingGodown = branchScope.filter((id) => !godowns.has(id));

  const demand: BuyEngineInput["demand"] = [];
  const issues: string[] = [];

  if (branchesMissingGodown.length > 0) {
    issues.push(
      "One or more branches have no active godown department (holds_raw) — demand for those branches could not be resolved to a ship-to department.",
    );
  }

  // Source 1: approved requisition lines decided "buy".
  const { data: reqLines } = await admin
    .from("requisitions")
    .select(
      "branch_id, requisition_lines!inner(item_type, item_id, qty_g, approved_qty_g, decision)",
    )
    .in("branch_id", branchScope)
    .eq("status", "approved")
    .eq("requisition_lines.decision", "buy");

  let requisitionLineCount = 0;
  for (const req of reqLines ?? []) {
    const godown = godowns.get(req.branch_id);
    if (!godown) continue;
    for (const line of req.requisition_lines as unknown as {
      item_type: "raw" | "flavour";
      item_id: string;
      qty_g: number;
      approved_qty_g: number | null;
    }[]) {
      const qtyG = line.approved_qty_g ?? line.qty_g;
      if (qtyG <= 0) continue;
      demand.push({
        itemType: line.item_type,
        itemId: line.item_id,
        qtyG,
        departmentId: godown.id,
      });
      requisitionLineCount++;
    }
  }

  // Source 2: optional par top-up — shortfall against each department's own
  // par level and its own current stock, redirected to that branch's godown.
  if (includeParTopUp) {
    const { data: departments } = await admin
      .from("departments")
      .select("id, branch_id")
      .in("branch_id", branchScope)
      .eq("is_active", true);
    const deptIds = (departments ?? []).map((d) => d.id);
    const branchByDept = new Map((departments ?? []).map((d) => [d.id, d.branch_id]));

    if (deptIds.length > 0) {
      const [{ data: parLevels }, { data: balances }] = await Promise.all([
        admin
          .from("par_levels")
          .select("department_id, item_type, item_id, par_qty_g")
          .in("department_id", deptIds),
        admin
          .from("stock_balances")
          .select("department_id, item_type, item_id, qty_g")
          .in("department_id", deptIds),
      ]);
      const balanceByKey = new Map(
        (balances ?? []).map((b) => [
          `${b.department_id}|${b.item_type}|${b.item_id}`,
          b.qty_g,
        ]),
      );
      for (const par of parLevels ?? []) {
        const branchId = branchByDept.get(par.department_id);
        const godown = branchId ? godowns.get(branchId) : undefined;
        if (!godown) continue;
        const haveG =
          balanceByKey.get(
            `${par.department_id}|${par.item_type}|${par.item_id}`,
          ) ?? 0;
        const shortfallG = par.par_qty_g - haveG;
        if (shortfallG <= 0) continue;
        demand.push({
          itemType: par.item_type,
          itemId: par.item_id,
          qtyG: shortfallG,
          departmentId: godown.id,
        });
      }
    }
  }

  // Source 3: manual entry, resolved to the picked branch's godown.
  for (const entry of parsedManual.data) {
    if (!branchScope.includes(entry.branchId)) continue;
    const godown = godowns.get(entry.branchId);
    if (!godown) continue;
    demand.push({
      itemType: entry.itemType,
      itemId: entry.itemId,
      qtyG: entry.qtyG,
      departmentId: godown.id,
    });
  }

  if (demand.length === 0) {
    return { success: true, data: { groups: [], issues, requisitionLineCount } };
  }

  const departmentIds = [...new Set(demand.map((d) => d.departmentId))];
  const flavourIds = [
    ...new Set(demand.filter((d) => d.itemType === "flavour").map((d) => d.itemId)),
  ];

  const [
    { data: balances },
    { data: openPoRows },
    { data: flavours },
    { data: rawMaterials },
    { data: suppliers },
  ] = await Promise.all([
    admin
      .from("stock_balances")
      .select("department_id, item_type, item_id, qty_g")
      .in("department_id", departmentIds),
    admin
      .from("po_lines")
      .select(
        "raw_material_id, qty_g, purchase_orders!inner(ship_to_department_id, status)",
      )
      .in("purchase_orders.ship_to_department_id", departmentIds)
      .in("purchase_orders.status", ["draft", "sent", "partially_received"]),
    flavourIds.length > 0
      ? admin
          .from("flavours")
          .select("id, name, current_version_id")
          .in("id", flavourIds)
      : Promise.resolve({ data: [] }),
    admin
      .from("raw_materials")
      .select("id, code, name, default_supplier_id")
      .eq("is_active", true),
    admin.from("suppliers").select("id, name"),
  ]);

  const versionIds = (flavours ?? [])
    .map((f) => f.current_version_id)
    .filter((id): id is string => !!id);
  const [{ data: versions }, { data: recipeLines }] = await Promise.all([
    versionIds.length > 0
      ? admin
          .from("recipe_versions")
          .select("id, flavour_id, wastage_pct")
          .in("id", versionIds)
      : Promise.resolve({ data: [] }),
    versionIds.length > 0
      ? admin
          .from("recipe_lines")
          .select("recipe_version_id, raw_material_id, percentage")
          .in("recipe_version_id", versionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const currentRecipeVersions: BuyEngineInput["currentRecipeVersions"] = (
    versions ?? []
  ).map((v) => ({
    flavourId: v.flavour_id,
    wastagePct: Number(v.wastage_pct),
    lines: (recipeLines ?? [])
      .filter((l) => l.recipe_version_id === v.id)
      .map((l) => ({
        rawMaterialId: l.raw_material_id,
        percentage: Number(l.percentage),
      })),
  }));

  const defaultSuppliers: BuyEngineInput["defaultSuppliers"] = (
    rawMaterials ?? []
  )
    .filter((m) => !!m.default_supplier_id)
    .map((m) => ({
      rawMaterialId: m.id,
      supplierId: m.default_supplier_id as string,
    }));

  const stockBalances: BuyEngineInput["stockBalances"] = (balances ?? []).map(
    (b) => ({
      departmentId: b.department_id,
      itemType: b.item_type,
      itemId: b.item_id,
      qtyG: b.qty_g,
    }),
  );

  const openPoLines: BuyEngineInput["openPoLines"] = (openPoRows ?? []).map(
    (r) => ({
      departmentId: (
        r.purchase_orders as unknown as { ship_to_department_id: string }
      ).ship_to_department_id,
      rawMaterialId: r.raw_material_id,
      qtyG: r.qty_g,
    }),
  );

  const result = computeBuyPlan({
    demand,
    stockBalances,
    openPoLines,
    currentRecipeVersions,
    defaultSuppliers,
  });

  const rawMaterialById = new Map((rawMaterials ?? []).map((m) => [m.id, m]));
  const supplierById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const departmentNameById = new Map(
    [...godowns.values()].map((g) => [g.id, g.name]),
  );
  const branchIdByDepartmentId = new Map(
    [...godowns.entries()].map(([branchId, g]) => [g.id, branchId]),
  );

  // Rebuilt with real names rather than passed through verbatim — the
  // engine's issue strings carry raw ids (it has no name lookups, being a
  // pure function). "No default supplier" isn't surfaced here at all:
  // every such group already renders its own supplier picker in the UI,
  // so a duplicate text warning would just be noise.
  const flavourById = new Map((flavours ?? []).map((f) => [f.id, f]));
  const displayIssues = [
    ...issues,
    ...[...new Set(flavourIds)]
      .filter((id) => !flavourById.get(id)?.current_version_id)
      .map(
        (id) =>
          `${flavourById.get(id)?.name ?? "A flavour"} has no current recipe version — its demand could not be exploded into raw material need.`,
      ),
  ];

  const groups: BuyGroupView[] = result.groups.map((g) => ({
    key: `${g.supplierId ?? "unassigned"}|${g.departmentId}`,
    supplierId: g.supplierId,
    supplierName: g.supplierId ? (supplierById.get(g.supplierId) ?? null) : null,
    departmentId: g.departmentId,
    departmentName: departmentNameById.get(g.departmentId) ?? "Unknown",
    branchId: branchIdByDepartmentId.get(g.departmentId) ?? "",
    lines: g.lines.map((l) => ({
      rawMaterialId: l.rawMaterialId,
      rawMaterialName: rawMaterialById.get(l.rawMaterialId)?.name ?? "Unknown",
      rawMaterialCode: rawMaterialById.get(l.rawMaterialId)?.code ?? null,
      neededG: l.neededG,
      haveG: l.haveG,
      onOrderG: l.onOrderG,
      buyG: l.buyG,
    })),
  }));

  return {
    success: true,
    data: { groups, issues: displayIssues, requisitionLineCount },
  };
}

const createOrdersSchema = z.array(
  z.object({
    supplierId: z.uuid(),
    departmentId: z.uuid(),
    lines: z
      .array(
        z.object({
          rawMaterialId: z.uuid(),
          qtyG: z.coerce.number().int().positive(),
          // A blank rate is valid — it marks the order rate-to-confirm.
          rate: z.coerce.number().nonnegative().nullable().optional(),
        }),
      )
      .min(1),
  }),
);

export async function createDraftOrders(
  groups: z.infer<typeof createOrdersSchema>,
): Promise<ActionResult<{ id: string; poNo: string }[]>> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };
  if (!can(session.role, "purchase:manage")) {
    return { success: false, error: "You can't create purchase orders." };
  }

  const parsed = createOrdersSchema.safeParse(groups);
  if (!parsed.success) {
    return { success: false, error: "Invalid order." };
  }

  const admin = createAdminClient();
  const departmentIds = [...new Set(parsed.data.map((g) => g.departmentId))];
  const { data: departments } = await admin
    .from("departments")
    .select("id, branch_id")
    .in("id", departmentIds);
  const branchByDepartment = new Map(
    (departments ?? []).map((d) => [d.id, d.branch_id]),
  );

  if (session.role !== "admin") {
    const outOfScope = parsed.data.some(
      (g) => branchByDepartment.get(g.departmentId) !== session.branchId,
    );
    if (outOfScope) return { success: false, error: "Access required." };
  }

  const supabase = await createClient();
  const created: { id: string; poNo: string }[] = [];

  for (const group of parsed.data) {
    const branchId = branchByDepartment.get(group.departmentId);
    if (!branchId) {
      return { success: false, error: "Ship-to department not found." };
    }

    const { data: poNo, error: poNoError } = await supabase.rpc("next_doc_no", {
      p_doc_type: "PO",
      p_branch_id: branchId,
    });
    if (poNoError || !poNo) {
      return {
        success: false,
        error: poNoError?.message ?? "Could not generate order number.",
      };
    }

    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .insert({
        po_no: poNo,
        branch_id: branchId,
        supplier_id: group.supplierId,
        ship_to_department_id: group.departmentId,
        created_by: session.userId,
      })
      .select("id, po_no")
      .single();
    if (poError || !po) {
      return {
        success: false,
        error: poError?.message ?? "Could not create purchase order.",
      };
    }

    const { error: linesError } = await supabase.from("po_lines").insert(
      group.lines.map((line) => ({
        purchase_order_id: po.id,
        raw_material_id: line.rawMaterialId,
        qty_g: line.qtyG,
        rate: line.rate ?? null,
      })),
    );
    if (linesError) return { success: false, error: linesError.message };

    created.push({ id: po.id, poNo: po.po_no });
  }

  revalidatePath("/purchases");
  revalidatePath("/purchases/orders");
  return { success: true, data: created };
}

export type BuyFormOptions = {
  branches: { id: string; name: string }[];
  rawMaterials: { id: string; code: string | null; name: string }[];
  flavours: { id: string; code: string | null; name: string }[];
  suppliers: { id: string; name: string }[];
};

export async function getBuyFormOptions(): Promise<
  ActionResult<BuyFormOptions>
> {
  const session = await requireBuyAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  let branchesQuery = admin.from("branches").select("id, name").eq("is_active", true);
  if (session.role !== "admin" && session.branchId) {
    branchesQuery = branchesQuery.eq("id", session.branchId);
  }

  const [{ data: branches }, { data: rawMaterials }, { data: flavours }, { data: suppliers }] =
    await Promise.all([
      branchesQuery.order("name"),
      admin
        .from("raw_materials")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name"),
      admin
        .from("flavours")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name"),
      admin.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    ]);

  return {
    success: true,
    data: {
      branches: branches ?? [],
      rawMaterials: rawMaterials ?? [],
      flavours: flavours ?? [],
      suppliers: suppliers ?? [],
    },
  };
}
