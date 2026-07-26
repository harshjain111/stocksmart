// The buy engine (5.2): a pure function, no I/O. Everything it needs —
// demand, current stock, open PO quantity, current recipe versions,
// default suppliers — is passed in; the caller (5.3's Server Action) is
// the only thing that touches Supabase. This is what makes it testable
// with plain unit tests and safe to reason about: same input, same
// output, always.
//
// Per fulfilling department (never mixed across departments, which is
// what keeps one branch's requirement from ever netting against
// another branch's stock — every net-off below happens strictly within
// a single department's own numbers):
//   1. Flavour demand nets off that department's own mixed-flavour
//      stock first.
//   2. Whatever flavour demand remains explodes into raw material need
//      through the flavour's *current* recipe version, applying that
//      version's wastage — same formula createDraftBatch() already
//      uses (Math.round(qty * pct/100 * (1 + wastage/100))), kept
//      identical for consistency across the codebase.
//   3. Raw material demand (direct lines + exploded-from-flavour) nets
//      off that department's current stock and already-open PO
//      quantity.
//   4. Any remaining shortfall groups into one bucket per (supplier,
//      department) — never merged across departments, so 5.3/5.4 can
//      turn each bucket into its own draft PO with the right ship-to.

export type ItemType = "raw" | "flavour";

export type DemandLine = {
  itemType: ItemType;
  itemId: string;
  qtyG: number;
  departmentId: string;
};

export type StockBalance = {
  departmentId: string;
  itemType: ItemType;
  itemId: string;
  qtyG: number;
};

export type OpenPoLine = {
  departmentId: string;
  rawMaterialId: string;
  qtyG: number;
};

export type RecipeLine = {
  rawMaterialId: string;
  percentage: number;
};

export type CurrentRecipeVersion = {
  flavourId: string;
  wastagePct: number;
  lines: RecipeLine[];
};

export type DefaultSupplier = {
  rawMaterialId: string;
  supplierId: string;
};

export type BuyEngineInput = {
  demand: DemandLine[];
  stockBalances: StockBalance[];
  openPoLines: OpenPoLine[];
  currentRecipeVersions: CurrentRecipeVersion[];
  defaultSuppliers: DefaultSupplier[];
};

export type BuyLine = {
  rawMaterialId: string;
  neededG: number;
  haveG: number;
  onOrderG: number;
  buyG: number;
};

export type SupplierGroup = {
  // null = no default supplier on record for this material — 5.3 needs
  // a manual pick before a PO can be drafted for this group.
  supplierId: string | null;
  departmentId: string;
  lines: BuyLine[];
};

export type BuyEngineResult = {
  groups: SupplierGroup[];
  issues: string[];
};

function key(itemType: ItemType, itemId: string): string {
  return `${itemType}|${itemId}`;
}

export function computeBuyPlan(input: BuyEngineInput): BuyEngineResult {
  const {
    demand,
    stockBalances,
    openPoLines,
    currentRecipeVersions,
    defaultSuppliers,
  } = input;

  const issues: string[] = [];

  const recipeByFlavourId = new Map(
    currentRecipeVersions.map((v) => [v.flavourId, v]),
  );
  const supplierByRawMaterialId = new Map(
    defaultSuppliers.map((s) => [s.rawMaterialId, s.supplierId]),
  );

  const stockByDeptAndKey = new Map<string, number>();
  for (const b of stockBalances) {
    stockByDeptAndKey.set(
      `${b.departmentId}|${key(b.itemType, b.itemId)}`,
      b.qtyG,
    );
  }
  const openPoByDeptAndRaw = new Map<string, number>();
  for (const p of openPoLines) {
    const k = `${p.departmentId}|${p.rawMaterialId}`;
    openPoByDeptAndRaw.set(k, (openPoByDeptAndRaw.get(k) ?? 0) + p.qtyG);
  }

  const demandByDept = new Map<string, DemandLine[]>();
  for (const line of demand) {
    const list = demandByDept.get(line.departmentId) ?? [];
    list.push(line);
    demandByDept.set(line.departmentId, list);
  }

  // (supplierId ?? "__unassigned__", departmentId) -> rawMaterialId -> BuyLine
  const groupMap = new Map<string, Map<string, BuyLine>>();

  for (const [departmentId, lines] of demandByDept) {
    // Raw material need for this department only, before netting.
    const rawNeed = new Map<string, number>();

    for (const line of lines) {
      if (line.itemType === "raw") {
        rawNeed.set(line.itemId, (rawNeed.get(line.itemId) ?? 0) + line.qtyG);
        continue;
      }

      // Flavour demand nets off this department's own mixed stock first.
      const haveFlavourG =
        stockByDeptAndKey.get(`${departmentId}|${key("flavour", line.itemId)}`) ??
        0;
      const remainingFlavourG = Math.max(0, line.qtyG - haveFlavourG);
      if (remainingFlavourG === 0) continue;

      const version = recipeByFlavourId.get(line.itemId);
      if (!version) {
        issues.push(
          `Flavour ${line.itemId} has no current recipe version — ${remainingFlavourG}g of demand at department ${departmentId} could not be exploded into raw material need.`,
        );
        continue;
      }

      const wastageMultiplier = 1 + version.wastagePct / 100;
      for (const recipeLine of version.lines) {
        const explodedG = Math.round(
          remainingFlavourG * (recipeLine.percentage / 100) * wastageMultiplier,
        );
        rawNeed.set(
          recipeLine.rawMaterialId,
          (rawNeed.get(recipeLine.rawMaterialId) ?? 0) + explodedG,
        );
      }
    }

    // Net raw material need off this department's stock and open POs.
    for (const [rawMaterialId, neededG] of rawNeed) {
      const haveG =
        stockByDeptAndKey.get(`${departmentId}|${key("raw", rawMaterialId)}`) ??
        0;
      const onOrderG = openPoByDeptAndRaw.get(`${departmentId}|${rawMaterialId}`) ?? 0;
      const buyG = Math.max(0, neededG - haveG - onOrderG);
      if (buyG === 0) continue;

      const supplierId = supplierByRawMaterialId.get(rawMaterialId) ?? null;
      if (!supplierId) {
        issues.push(
          `Raw material ${rawMaterialId} has no default supplier — ${buyG}g of shortfall at department ${departmentId} needs a supplier picked manually.`,
        );
      }

      const groupKey = `${supplierId ?? "__unassigned__"}|${departmentId}`;
      const lineMap = groupMap.get(groupKey) ?? new Map<string, BuyLine>();
      lineMap.set(rawMaterialId, {
        rawMaterialId,
        neededG,
        haveG,
        onOrderG,
        buyG,
      });
      groupMap.set(groupKey, lineMap);
    }
  }

  const groups: SupplierGroup[] = [...groupMap.entries()].map(
    ([groupKey, lineMap]) => {
      const [supplierPart, departmentId] = groupKey.split("|");
      return {
        supplierId: supplierPart === "__unassigned__" ? null : supplierPart,
        departmentId,
        lines: [...lineMap.values()],
      };
    },
  );

  return { groups, issues };
}
