import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessPurchasesTab } from "@/lib/purchases-tabs";
import { createAdminClient } from "@/lib/supabase/admin";
import { OverviewView, type OverviewData } from "@/components/purchases/overview-view";

// Pipeline stage definitions (documented here since the schema doesn't have
// a 1:1 status for each mockup stage):
//   To Order    = PO status 'draft' — created, not yet sent to the supplier.
//   Ordered     = PO status 'sent' — sent, nothing received yet (the
//                 post_grn function auto-advances status the moment any GRN
//                 posts, so 'sent' always means zero receipts so far).
//   In Transit  = the subset of 'sent' orders that are NOT past their
//                 expected_delivery_date — still on schedule. The overdue
//                 subset (sent + past due) surfaces in Needs Attention
//                 instead of being double-counted here.
//   Partially / Received = the matching PO statuses directly.
export default async function PurchasesOverviewPage() {
  const session = await getSession();
  if (!session || !canAccessPurchasesTab(session.role, "/purchases")) {
    redirect("/");
  }

  const admin = createAdminClient();

  let poQuery = admin
    .from("purchase_orders")
    .select(
      "id, po_no, status, branch_id, created_at, sent_at, expected_delivery_date, supplier_id, ship_to_department_id, suppliers(name), departments(name), po_lines(qty_g, rate)",
    )
    .neq("status", "cancelled");
  if (session.role !== "admin") {
    poQuery = poQuery.eq("branch_id", session.branchId ?? "");
  }

  let reqQuery = admin
    .from("requisitions")
    .select("branch_id, requisition_lines!inner(id, decision, ref_id)")
    .eq("status", "approved")
    .eq("requisition_lines.decision", "buy")
    .is("requisition_lines.ref_id", null);
  if (session.role !== "admin") {
    reqQuery = reqQuery.eq("branch_id", session.branchId ?? "");
  }

  const [{ data: orders }, { data: waitingReqs }] = await Promise.all([
    poQuery,
    reqQuery,
  ]);

  type OrderRow = {
    id: string;
    po_no: string;
    status: string;
    created_at: string;
    sent_at: string | null;
    expected_delivery_date: string | null;
    suppliers: { name: string } | null;
    departments: { name: string } | null;
    po_lines: { qty_g: number; rate: number | null }[];
  };
  const orderRows = (orders ?? []) as unknown as OrderRow[];
  const poIds = orderRows.map((o) => o.id);

  const [{ data: grns }, { data: allGrnLinesForItems }] = await Promise.all([
    poIds.length > 0
      ? admin
          .from("grns")
          .select(
            "id, grn_no, purchase_order_id, status, posted_at, transportation_cost, grn_lines(item_type, item_id, received_qty_g, damaged_qty_g, rate)",
          )
          .in("purchase_order_id", poIds)
          .eq("source", "vendor")
      : Promise.resolve({ data: [] }),
    // Top purchased items / purchase summary: posted vendor receipts only —
    // a PO with no GRN yet hasn't actually been "purchased" in spend terms.
    poIds.length > 0
      ? admin
          .from("grns")
          .select(
            "posted_at, transportation_cost, grn_lines(item_type, item_id, received_qty_g, damaged_qty_g, rate)",
          )
          .in("purchase_order_id", poIds)
          .eq("source", "vendor")
          .eq("status", "posted")
      : Promise.resolve({ data: [] }),
  ]);

  type GrnRow = {
    id: string;
    grn_no: string;
    purchase_order_id: string;
    status: string;
    posted_at: string | null;
    transportation_cost: number | null;
    grn_lines: {
      item_type: "raw" | "flavour";
      item_id: string;
      received_qty_g: number | null;
      damaged_qty_g: number | null;
      rate: number | null;
    }[];
  };
  const grnRows = (grns ?? []) as unknown as GrnRow[];
  const postedGrnsByPo = new Map<string, GrnRow[]>();
  for (const g of grnRows) {
    if (g.status !== "posted") continue;
    const list = postedGrnsByPo.get(g.purchase_order_id) ?? [];
    list.push(g);
    postedGrnsByPo.set(g.purchase_order_id, list);
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const orderValueRupees = (o: OrderRow) =>
    o.po_lines.reduce((sum, l) => sum + (l.qty_g / 1000) * (l.rate ?? 0), 0);

  let toOrder = { count: 0, worthRupees: 0 };
  let ordered = { count: 0, worthRupees: 0 };
  let inTransit = { count: 0, worthRupees: 0 };
  let partiallyReceived = { count: 0, worthRupees: 0 };
  let receivedThisMonth = { count: 0, worthRupees: 0 };
  let overduePOs = 0;
  let leadTimeDaysSum = 0;
  let leadTimeCount = 0;

  for (const o of orderRows) {
    const value = orderValueRupees(o);
    const grnsForPo = postedGrnsByPo.get(o.id) ?? [];
    const firstReceiptAt = grnsForPo
      .map((g) => g.posted_at)
      .filter((d): d is string => !!d)
      .sort()[0];

    if (o.status === "draft") {
      toOrder = { count: toOrder.count + 1, worthRupees: toOrder.worthRupees + value };
    } else if (o.status === "sent") {
      ordered = { count: ordered.count + 1, worthRupees: ordered.worthRupees + value };
      const overdue =
        o.expected_delivery_date && new Date(o.expected_delivery_date) < now;
      if (overdue) {
        overduePOs++;
      } else {
        inTransit = {
          count: inTransit.count + 1,
          worthRupees: inTransit.worthRupees + value,
        };
      }
    } else if (o.status === "partially_received") {
      partiallyReceived = {
        count: partiallyReceived.count + 1,
        worthRupees: partiallyReceived.worthRupees + value,
      };
    } else if (o.status === "received" || o.status === "closed") {
      if (firstReceiptAt && new Date(firstReceiptAt) >= monthStart) {
        receivedThisMonth = {
          count: receivedThisMonth.count + 1,
          worthRupees: receivedThisMonth.worthRupees + value,
        };
      }
    }

    if (firstReceiptAt && o.sent_at) {
      leadTimeDaysSum +=
        (new Date(firstReceiptAt).getTime() - new Date(o.sent_at).getTime()) /
        (24 * 60 * 60 * 1000);
      leadTimeCount++;
    }
  }

  // This-month purchase value / transportation cost, from posted GRNs —
  // "actual purchase value" per the spec, not the PO's nominal value.
  let purchaseValueThisMonth = 0;
  let purchaseValueLastMonth = 0;
  let transportationCostThisMonth = 0;
  const itemAgg = new Map<
    string,
    { itemType: "raw" | "flavour"; itemId: string; qtyG: number; valueRupees: number }
  >();
  let rawValueThisMonth = 0;
  let flavourValueThisMonth = 0;

  for (const g of (allGrnLinesForItems ?? []) as unknown as {
    posted_at: string | null;
    transportation_cost: number | null;
    grn_lines: {
      item_type: "raw" | "flavour";
      item_id: string;
      received_qty_g: number | null;
      damaged_qty_g: number | null;
      rate: number | null;
    }[];
  }[]) {
    if (!g.posted_at) continue;
    const postedAt = new Date(g.posted_at);
    const inThisMonth = postedAt >= monthStart;
    const inLastMonth = postedAt >= lastMonthStart && postedAt < monthStart;
    if (!inThisMonth && !inLastMonth) continue;

    for (const l of g.grn_lines) {
      const qtyG = (l.received_qty_g ?? 0) + (l.damaged_qty_g ?? 0);
      const value = (qtyG / 1000) * (l.rate ?? 0);
      if (inThisMonth) {
        purchaseValueThisMonth += value;
        if (l.item_type === "raw") rawValueThisMonth += value;
        else flavourValueThisMonth += value;

        const key = `${l.item_type}|${l.item_id}`;
        const entry = itemAgg.get(key) ?? {
          itemType: l.item_type,
          itemId: l.item_id,
          qtyG: 0,
          valueRupees: 0,
        };
        entry.qtyG += qtyG;
        entry.valueRupees += value;
        itemAgg.set(key, entry);
      } else {
        purchaseValueLastMonth += value;
      }
    }
    if (inThisMonth && g.transportation_cost) {
      transportationCostThisMonth += Number(g.transportation_cost);
    }
  }

  const vsLastMonthPct =
    purchaseValueLastMonth > 0
      ? Math.round(
          ((purchaseValueThisMonth - purchaseValueLastMonth) / purchaseValueLastMonth) *
            1000,
        ) / 10
      : null;

  // Resolve names for the top-purchased-items table.
  const rawIds = [...itemAgg.values()].filter((e) => e.itemType === "raw").map((e) => e.itemId);
  const flavourIds = [...itemAgg.values()].filter((e) => e.itemType === "flavour").map((e) => e.itemId);
  const [{ data: rawMaterials }, { data: flavours }] = await Promise.all([
    rawIds.length > 0
      ? admin.from("raw_materials").select("id, name").in("id", rawIds)
      : Promise.resolve({ data: [] }),
    flavourIds.length > 0
      ? admin.from("flavours").select("id, name").in("id", flavourIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map(
    [...(rawMaterials ?? []), ...(flavours ?? [])].map((m) => [m.id, m.name]),
  );

  const topPurchasedItems = [...itemAgg.values()]
    .sort((a, b) => b.valueRupees - a.valueRupees)
    .slice(0, 5)
    .map((e) => ({
      name: nameById.get(e.itemId) ?? "Unknown item",
      type: e.itemType,
      qtyG: e.qtyG,
      valueRupees: e.valueRupees,
    }));

  // Supplier performance average — reuses the same on-time definition as
  // the Supplier Performance tab (expected_delivery_date when set, a
  // 7-day-from-sent proxy otherwise), averaged across suppliers with at
  // least one received order this quarter-ish window (all history, kept
  // simple — this is a summary tile, the full breakdown lives on its own
  // tab).
  let onTimeCount = 0;
  let receivedCount = 0;
  for (const o of orderRows) {
    const grnsForPo = postedGrnsByPo.get(o.id) ?? [];
    const firstReceiptAt = grnsForPo
      .map((g) => g.posted_at)
      .filter((d): d is string => !!d)
      .sort()[0];
    if (!firstReceiptAt || !o.sent_at) continue;
    receivedCount++;
    const onTime = o.expected_delivery_date
      ? new Date(firstReceiptAt) <=
        new Date(new Date(o.expected_delivery_date).getTime() + 24 * 60 * 60 * 1000)
      : (new Date(firstReceiptAt).getTime() - new Date(o.sent_at).getTime()) /
          (24 * 60 * 60 * 1000) <=
        7;
    if (onTime) onTimeCount++;
  }

  const attentionItems: { label: string; tone: "destructive" | "warning" | "success" }[] =
    [];
  if (overduePOs > 0) {
    attentionItems.push({
      label: `${overduePOs} PO${overduePOs === 1 ? "" : "s"} overdue`,
      tone: "destructive",
    });
  }
  if (partiallyReceived.count > 0) {
    attentionItems.push({
      label: `${partiallyReceived.count} PO${partiallyReceived.count === 1 ? "" : "s"} partially received`,
      tone: "warning",
    });
  }
  const requisitionsWaiting = waitingReqs?.length ?? 0;
  if (requisitionsWaiting > 0) {
    attentionItems.push({
      label: `${requisitionsWaiting} requisition line${requisitionsWaiting === 1 ? "" : "s"} waiting`,
      tone: "warning",
    });
  }
  const receivedThisWeek = grnRows.filter(
    (g) => g.posted_at && new Date(g.posted_at) >= weekAgo,
  ).length;
  if (receivedThisWeek > 0) {
    attentionItems.push({
      label: `${receivedThisWeek} order${receivedThisWeek === 1 ? "" : "s"} received this week`,
      tone: "success",
    });
  }

  const recentOrders = orderRows
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
    .map((o) => {
      const daysLeft = o.expected_delivery_date
        ? Math.ceil(
            (new Date(o.expected_delivery_date).getTime() - now.getTime()) /
              (24 * 60 * 60 * 1000),
          )
        : null;
      return {
        id: o.id,
        poNo: o.po_no,
        itemCount: o.po_lines.length,
        orderDate: o.created_at,
        expectedDate: o.expected_delivery_date,
        daysLeft,
        status: o.status,
        valueRupees: orderValueRupees(o),
      };
    });

  const poNoById = new Map(orderRows.map((o) => [o.id, o.po_no]));
  const recentGrns = grnRows
    .filter((g) => g.status === "posted")
    .slice()
    .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
    .slice(0, 5)
    .map((g) => ({
      id: g.id,
      grnNo: g.grn_no,
      poNo: poNoById.get(g.purchase_order_id) ?? "—",
      date: g.posted_at,
      itemCount: g.grn_lines.length,
      transportCost: g.transportation_cost == null ? null : Number(g.transportation_cost),
      valueRupees: g.grn_lines.reduce(
        (sum, l) => sum + ((l.received_qty_g ?? 0) / 1000) * (l.rate ?? 0),
        0,
      ),
    }));

  const data: OverviewData = {
    kpis: {
      toOrder,
      ordered,
      inTransit,
      partiallyReceived,
      receivedThisMonth,
      purchaseValueThisMonth,
      transportationCostThisMonth,
      avgLeadTimeDays: leadTimeCount > 0 ? leadTimeDaysSum / leadTimeCount : null,
      supplierPerformancePct:
        receivedCount > 0 ? Math.round((onTimeCount / receivedCount) * 100) : null,
    },
    pipeline: {
      toOrder: toOrder.count,
      ordered: ordered.count,
      inTransit: inTransit.count,
      partiallyReceived: partiallyReceived.count,
      received: receivedThisMonth.count,
    },
    attentionItems,
    recentOrders,
    recentGrns,
    topPurchasedItems,
    purchaseSummary: {
      rawValueRupees: rawValueThisMonth,
      flavourValueRupees: flavourValueThisMonth,
      totalRupees: purchaseValueThisMonth,
      vsLastMonthPct,
    },
  };

  return <OverviewView data={data} />;
}
