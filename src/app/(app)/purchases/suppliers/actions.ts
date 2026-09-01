"use server";

import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

// "On time" compares actual receipt against expected_delivery_date when
// the order has one. Older orders (or ones nobody set a date on) fall back
// to this proxy — received within a week of being sent — stated plainly
// here and on the screen rather than left implicit.
const ON_TIME_DAYS = 7;

async function requirePerformanceAccess() {
  const session = await getSession();
  if (!session || !can(session.role, "purchase:history")) return null;
  return session;
}

export type SupplierPerformance = {
  supplierId: string;
  supplierName: string;
  sentCount: number;
  onTimeCount: number;
  onTimePct: number | null;
  receivedOrderCount: number;
  shortOrderCount: number;
  shortSupplyPct: number | null;
  avgLeadTimeDays: number | null;
  rateTrendPct: number | null;
  materialsTracked: number;
};

export async function getSupplierPerformance(): Promise<
  ActionResult<{ suppliers: SupplierPerformance[]; onTimeDays: number }>
> {
  const session = await requirePerformanceAccess();
  if (!session) return { success: false, error: "Access required." };

  const admin = createAdminClient();

  let poQuery = admin
    .from("purchase_orders")
    .select(
      "id, supplier_id, sent_at, expected_delivery_date, branch_id, suppliers(name)",
    )
    .not("sent_at", "is", null);
  if (session.role !== "admin") {
    poQuery = poQuery.eq("branch_id", session.branchId ?? "");
  }
  const { data: orders, error: ordersError } = await poQuery;
  if (ordersError) return { success: false, error: ordersError.message };

  type OrderRow = {
    id: string;
    supplier_id: string;
    sent_at: string;
    expected_delivery_date: string | null;
    suppliers: { name: string } | null;
  };
  const orderRows = (orders ?? []) as unknown as OrderRow[];
  const poIds = orderRows.map((o) => o.id);

  const { data: grnLines } =
    poIds.length > 0
      ? await admin
          .from("grn_lines")
          .select(
            "expected_qty_g, received_qty_g, damaged_qty_g, grns!inner(posted_at, status, source, purchase_order_id)",
          )
          .eq("grns.source", "vendor")
          .eq("grns.status", "posted")
          .in("grns.purchase_order_id", poIds)
      : { data: [] };

  type GrnLineRow = {
    expected_qty_g: number;
    received_qty_g: number | null;
    damaged_qty_g: number | null;
    grns: { posted_at: string | null; purchase_order_id: string | null } | null;
  };
  const grnLineRows = (grnLines ?? []) as unknown as GrnLineRow[];

  const latestReceiptByPo = new Map<string, string>();
  const shortByPo = new Map<string, boolean>();
  for (const l of grnLineRows) {
    const poId = l.grns?.purchase_order_id;
    if (!poId) continue;
    const postedAt = l.grns?.posted_at;
    if (postedAt) {
      const existing = latestReceiptByPo.get(poId);
      if (!existing || postedAt > existing) latestReceiptByPo.set(poId, postedAt);
    }
    const totalG = (l.received_qty_g ?? 0) + (l.damaged_qty_g ?? 0);
    if (totalG < l.expected_qty_g) shortByPo.set(poId, true);
  }

  const supplierIds = [...new Set(orderRows.map((o) => o.supplier_id))];
  const { data: rateRows } =
    supplierIds.length > 0
      ? await admin
          .from("supplier_rates")
          .select("supplier_id, raw_material_id, rate, created_at")
          .in("supplier_id", supplierIds)
          .order("created_at", { ascending: true })
      : { data: [] };

  const rateHistoryBySupplierMaterial = new Map<string, { rate: number }[]>();
  for (const r of rateRows ?? []) {
    const key = `${r.supplier_id}|${r.raw_material_id}`;
    const list = rateHistoryBySupplierMaterial.get(key) ?? [];
    list.push({ rate: Number(r.rate) });
    rateHistoryBySupplierMaterial.set(key, list);
  }
  const materialKeysBySupplier = new Map<string, Set<string>>();
  for (const key of rateHistoryBySupplierMaterial.keys()) {
    const [supplierId, materialId] = key.split("|");
    const set = materialKeysBySupplier.get(supplierId) ?? new Set<string>();
    set.add(materialId);
    materialKeysBySupplier.set(supplierId, set);
  }

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const bySupplier = new Map<
    string,
    {
      supplierName: string;
      sentCount: number;
      onTimeCount: number;
      receivedOrderCount: number;
      shortOrderCount: number;
      leadTimeDaysSum: number;
    }
  >();

  for (const o of orderRows) {
    const entry = bySupplier.get(o.supplier_id) ?? {
      supplierName: o.suppliers?.name ?? "Unknown supplier",
      sentCount: 0,
      onTimeCount: 0,
      receivedOrderCount: 0,
      shortOrderCount: 0,
      leadTimeDaysSum: 0,
    };
    entry.sentCount += 1;

    const receivedAt = latestReceiptByPo.get(o.id);
    if (receivedAt) {
      entry.receivedOrderCount += 1;
      const daysTaken =
        (new Date(receivedAt).getTime() - new Date(o.sent_at).getTime()) /
        ONE_DAY_MS;
      entry.leadTimeDaysSum += daysTaken;
      const onTime = o.expected_delivery_date
        ? new Date(receivedAt).getTime() <=
          new Date(o.expected_delivery_date).getTime() + ONE_DAY_MS
        : daysTaken <= ON_TIME_DAYS;
      if (onTime) entry.onTimeCount += 1;
      if (shortByPo.get(o.id)) entry.shortOrderCount += 1;
    }

    bySupplier.set(o.supplier_id, entry);
  }

  const suppliers: SupplierPerformance[] = [...bySupplier.entries()]
    .map(([supplierId, s]) => {
      const materialKeys = [...(materialKeysBySupplier.get(supplierId) ?? [])];
      const trendPcts = materialKeys
        .map((materialId) => {
          const history = rateHistoryBySupplierMaterial.get(
            `${supplierId}|${materialId}`,
          );
          if (!history || history.length < 2) return null;
          const first = history[0].rate;
          const last = history[history.length - 1].rate;
          if (first === 0) return null;
          return ((last - first) / first) * 100;
        })
        .filter((v): v is number => v != null);

      return {
        supplierId,
        supplierName: s.supplierName,
        sentCount: s.sentCount,
        onTimeCount: s.onTimeCount,
        onTimePct:
          s.receivedOrderCount > 0
            ? Math.round((s.onTimeCount / s.receivedOrderCount) * 100)
            : null,
        receivedOrderCount: s.receivedOrderCount,
        shortOrderCount: s.shortOrderCount,
        shortSupplyPct:
          s.receivedOrderCount > 0
            ? Math.round((s.shortOrderCount / s.receivedOrderCount) * 100)
            : null,
        avgLeadTimeDays:
          s.receivedOrderCount > 0
            ? Math.round((s.leadTimeDaysSum / s.receivedOrderCount) * 10) / 10
            : null,
        rateTrendPct:
          trendPcts.length > 0
            ? Math.round(
                (trendPcts.reduce((sum, v) => sum + v, 0) / trendPcts.length) * 10,
              ) / 10
            : null,
        materialsTracked: trendPcts.length,
      };
    })
    .sort((a, b) => b.sentCount - a.sentCount);

  return { success: true, data: { suppliers, onTimeDays: ON_TIME_DAYS } };
}
