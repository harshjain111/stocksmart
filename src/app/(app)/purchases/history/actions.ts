"use server";

import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

async function requireHistoryAccess() {
  const session = await getSession();
  if (!session || !can(session.role, "purchase:history")) return null;
  return session;
}

export async function getHistoryFilterOptions(): Promise<
  ActionResult<{
    suppliers: { id: string; name: string }[];
    rawMaterials: { id: string; code: string | null; name: string }[];
  }>
> {
  const session = await requireHistoryAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();
  const [{ data: suppliers }, { data: rawMaterials }] = await Promise.all([
    admin.from("suppliers").select("id, name").order("name"),
    admin.from("raw_materials").select("id, code, name").order("name"),
  ]);

  return {
    success: true,
    data: { suppliers: suppliers ?? [], rawMaterials: rawMaterials ?? [] },
  };
}

export type PurchaseHistoryFilters = {
  supplierId?: string;
  rawMaterialId?: string;
  from?: string;
  to?: string;
};

type SupplierSummary = {
  supplierId: string;
  supplierName: string;
  orderCount: number;
  totalOrderedG: number;
  totalReceivedG: number;
  lastOrderAt: string;
};

type RatePoint = { rate: number; date: string; source: string };

type MaterialSummary = {
  rawMaterialId: string;
  itemType: "raw" | "flavour";
  name: string;
  code: string | null;
  orderCount: number;
  totalOrderedG: number;
  totalReceivedG: number;
  currentRate: number | null;
  rateHistory: RatePoint[];
};

type HistoryRecord = {
  type: "order" | "receipt";
  date: string;
  supplierName: string;
  materialName: string;
  materialCode: string | null;
  qtyG: number;
  rate: number | null;
};

export async function getPurchaseHistory(
  filters: PurchaseHistoryFilters,
): Promise<
  ActionResult<{
    bySupplier: SupplierSummary[];
    byMaterial: MaterialSummary[];
    records: HistoryRecord[];
  }>
> {
  const session = await requireHistoryAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();

  let poQuery = admin
    .from("purchase_orders")
    .select(
      "id, po_no, branch_id, created_at, supplier_id, suppliers(name), po_lines(raw_material_id, flavour_id, qty_g, rate, raw_materials(name, code), flavours(name, code))",
    );
  if (session.role !== "admin") {
    poQuery = poQuery.eq("branch_id", session.branchId ?? "");
  }
  if (filters.supplierId) poQuery = poQuery.eq("supplier_id", filters.supplierId);
  if (filters.from) poQuery = poQuery.gte("created_at", filters.from);
  if (filters.to) poQuery = poQuery.lte("created_at", filters.to);

  const { data: orders, error: ordersError } = await poQuery;
  if (ordersError) return { success: false, error: ordersError.message };

  type OrderRow = {
    id: string;
    po_no: string;
    branch_id: string;
    created_at: string;
    supplier_id: string;
    suppliers: { name: string } | null;
    po_lines: {
      raw_material_id: string | null;
      flavour_id: string | null;
      qty_g: number;
      rate: number | null;
      raw_materials: { name: string; code: string | null } | null;
      flavours: { name: string; code: string | null } | null;
    }[];
  };
  const orderRows = (orders ?? []) as unknown as OrderRow[];
  const poIds = orderRows.map((o) => o.id);

  // po_lines is polymorphic: exactly one of raw_material_id / flavour_id is
  // set (po_lines_exactly_one_item). Keying the per-item aggregation by
  // type as well as id is what keeps a flavour from colliding with a raw
  // material that happens to share a uuid, and what stops ready-made
  // flavour purchases showing up as "Unknown".
  type LineItem = {
    itemType: "raw" | "flavour";
    itemId: string;
    name: string;
    code: string | null;
  };
  function lineItem(line: OrderRow["po_lines"][number]): LineItem | null {
    if (line.raw_material_id) {
      return {
        itemType: "raw",
        itemId: line.raw_material_id,
        name: line.raw_materials?.name ?? "Unknown",
        code: line.raw_materials?.code ?? null,
      };
    }
    if (line.flavour_id) {
      return {
        itemType: "flavour",
        itemId: line.flavour_id,
        name: line.flavours?.name ?? "Unknown",
        code: line.flavours?.code ?? null,
      };
    }
    return null;
  }
  const itemKey = (itemType: string, itemId: string) => `${itemType}|${itemId}`;

  let receiptLines: {
    grn_id: string;
    item_type: "raw" | "flavour";
    item_id: string;
    received_qty_g: number | null;
    damaged_qty_g: number | null;
    rate: number | null;
    grns: {
      posted_at: string | null;
      purchase_order_id: string | null;
      purchase_orders: { supplier_id: string; suppliers: { name: string } | null } | null;
    } | null;
  }[] = [];
  if (poIds.length > 0) {
    // item_id is polymorphic (raw or flavour) with no FK, so raw_materials
    // can't be embedded here — resolved via a separate lookup below,
    // matching getGrnDetail()'s existing convention (receive/actions.ts).
    const { data, error: receiptsError } = await admin
      .from("grn_lines")
      .select(
        "grn_id, item_type, item_id, received_qty_g, damaged_qty_g, rate, grns!inner(posted_at, status, source, purchase_order_id, purchase_orders(supplier_id, suppliers(name)))",
      )
      .eq("grns.source", "vendor")
      .eq("grns.status", "posted")
      .in("grns.purchase_order_id", poIds);
    if (receiptsError) return { success: false, error: receiptsError.message };
    receiptLines = (data ?? []) as unknown as typeof receiptLines;
  }

  const receiptRawIds = [
    ...new Set(
      receiptLines.filter((l) => l.item_type === "raw").map((l) => l.item_id),
    ),
  ];
  const receiptFlavourIds = [
    ...new Set(
      receiptLines.filter((l) => l.item_type === "flavour").map((l) => l.item_id),
    ),
  ];
  const [{ data: receiptMaterials }, { data: receiptFlavours }] =
    await Promise.all([
      receiptRawIds.length > 0
        ? admin.from("raw_materials").select("id, name, code").in("id", receiptRawIds)
        : Promise.resolve({ data: [] }),
      receiptFlavourIds.length > 0
        ? admin.from("flavours").select("id, name, code").in("id", receiptFlavourIds)
        : Promise.resolve({ data: [] }),
    ]);
  const receiptItemByKey = new Map(
    [
      ...(receiptMaterials ?? []).map(
        (m) => [itemKey("raw", m.id), m] as const,
      ),
      ...(receiptFlavours ?? []).map(
        (f) => [itemKey("flavour", f.id), f] as const,
      ),
    ],
  );

  if (filters.rawMaterialId) {
    for (const o of orderRows) {
      o.po_lines = o.po_lines.filter(
        (l) => l.raw_material_id === filters.rawMaterialId,
      );
    }
  }

  const supplierMap = new Map<string, SupplierSummary>();
  const materialMap = new Map<
    string,
    {
      itemType: "raw" | "flavour";
      itemId: string;
      name: string;
      code: string | null;
      orderCount: Set<string>;
      totalOrderedG: number;
      totalReceivedG: number;
    }
  >();
  const records: HistoryRecord[] = [];

  for (const o of orderRows) {
    if (o.po_lines.length === 0) continue;
    const supplierName = o.suppliers?.name ?? "Unknown supplier";
    const existing = supplierMap.get(o.supplier_id);
    const orderedInThisPo = o.po_lines.reduce((sum, l) => sum + l.qty_g, 0);
    supplierMap.set(o.supplier_id, {
      supplierId: o.supplier_id,
      supplierName,
      orderCount: (existing?.orderCount ?? 0) + 1,
      totalOrderedG: (existing?.totalOrderedG ?? 0) + orderedInThisPo,
      totalReceivedG: existing?.totalReceivedG ?? 0,
      lastOrderAt:
        !existing || o.created_at > existing.lastOrderAt
          ? o.created_at
          : existing.lastOrderAt,
    });

    for (const line of o.po_lines) {
      const item = lineItem(line);
      if (!item) continue;
      const key = itemKey(item.itemType, item.itemId);
      const m = materialMap.get(key) ?? {
        itemType: item.itemType,
        itemId: item.itemId,
        name: item.name,
        code: item.code,
        orderCount: new Set<string>(),
        totalOrderedG: 0,
        totalReceivedG: 0,
      };
      m.orderCount.add(o.id);
      m.totalOrderedG += line.qty_g;
      materialMap.set(key, m);

      records.push({
        type: "order",
        date: o.created_at,
        supplierName,
        materialName: item.name,
        materialCode: item.code,
        qtyG: line.qty_g,
        rate: line.rate == null ? null : Number(line.rate),
      });
    }
  }

  const filteredPoIds = new Set(orderRows.map((o) => o.id));
  for (const l of receiptLines) {
    const grn = l.grns;
    const po = grn?.purchase_orders;
    if (!grn?.purchase_order_id || !filteredPoIds.has(grn.purchase_order_id)) continue;
    if (filters.rawMaterialId && l.item_id !== filters.rawMaterialId) continue;

    const totalG = (l.received_qty_g ?? 0) + (l.damaged_qty_g ?? 0);
    const supplierId = po?.supplier_id;
    if (supplierId) {
      const existing = supplierMap.get(supplierId);
      if (existing) {
        existing.totalReceivedG += totalG;
      }
    }
    const key = itemKey(l.item_type, l.item_id);
    const m = materialMap.get(key);
    if (m) m.totalReceivedG += totalG;

    const receiptItem = receiptItemByKey.get(key);
    records.push({
      type: "receipt",
      date: grn.posted_at ?? "",
      supplierName: po?.suppliers?.name ?? "Unknown supplier",
      materialName: receiptItem?.name ?? "Unknown",
      materialCode: receiptItem?.code ?? null,
      qtyG: totalG,
      rate: l.rate == null ? null : Number(l.rate),
    });
  }

  // supplier_rates is keyed on raw_material_id, so rate history exists for
  // raw materials only. A purchased flavour simply has none — it shows its
  // PO/GRN rates in the records list instead of a trend line.
  const materialIds = [...materialMap.values()]
    .filter((m) => m.itemType === "raw")
    .map((m) => m.itemId);
  const { data: rateRows } =
    materialIds.length > 0
      ? await admin
          .from("supplier_rates")
          .select("raw_material_id, rate, source, created_at")
          .in("raw_material_id", materialIds)
          .order("created_at", { ascending: true })
      : { data: [] };

  const rateHistoryByMaterial = new Map<string, RatePoint[]>();
  for (const r of rateRows ?? []) {
    const list = rateHistoryByMaterial.get(r.raw_material_id) ?? [];
    list.push({ rate: Number(r.rate), date: r.created_at, source: r.source });
    rateHistoryByMaterial.set(r.raw_material_id, list);
  }

  const bySupplier = [...supplierMap.values()].sort(
    (a, b) => b.totalOrderedG - a.totalOrderedG,
  );
  const byMaterial: MaterialSummary[] = [...materialMap.values()]
    .map((m) => {
      const history =
        m.itemType === "raw"
          ? (rateHistoryByMaterial.get(m.itemId) ?? [])
          : [];
      return {
        rawMaterialId: m.itemId,
        itemType: m.itemType,
        name: m.name,
        code: m.code,
        orderCount: m.orderCount.size,
        totalOrderedG: m.totalOrderedG,
        totalReceivedG: m.totalReceivedG,
        currentRate: history.length > 0 ? history[history.length - 1].rate : null,
        rateHistory: history,
      };
    })
    .sort((a, b) => b.totalOrderedG - a.totalOrderedG);

  records.sort((a, b) => (a.date < b.date ? 1 : -1));

  return { success: true, data: { bySupplier, byMaterial, records } };
}
