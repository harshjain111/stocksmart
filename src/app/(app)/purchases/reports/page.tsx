import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessPurchasesTab } from "@/lib/purchases-tabs";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReportsView, type ReportsData } from "@/components/purchases/reports-view";

const MONTHS_BACK = 6;

export default async function PurchaseReportsPage() {
  const session = await getSession();
  if (!session || !canAccessPurchasesTab(session.role, "/purchases/reports")) {
    redirect("/");
  }

  const admin = createAdminClient();

  let poQuery = admin.from("purchase_orders").select("id, branch_id, branches(name)");
  if (session.role !== "admin") {
    poQuery = poQuery.eq("branch_id", session.branchId ?? "");
  }
  const { data: orders } = await poQuery;
  type OrderRow = { id: string; branch_id: string; branches: { name: string } | null };
  const orderRows = (orders ?? []) as unknown as OrderRow[];
  const poIds = orderRows.map((o) => o.id);
  const branchNameByPo = new Map(orderRows.map((o) => [o.id, o.branches?.name ?? ""]));

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_BACK - 1), 1);

  const { data: grns } =
    poIds.length > 0
      ? await admin
          .from("grns")
          .select(
            "purchase_order_id, posted_at, transportation_cost, grn_lines(item_type, item_id, received_qty_g, damaged_qty_g, rate)",
          )
          .in("purchase_order_id", poIds)
          .eq("source", "vendor")
          .eq("status", "posted")
          .gte("posted_at", windowStart.toISOString())
      : { data: [] };

  type GrnRow = {
    purchase_order_id: string;
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

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

  const months: { key: string; label: string }[] = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: monthLabel(d) });
  }

  const spendByMonth = new Map<string, number>();
  const transportByMonth = new Map<string, number>();
  const spendByBranch = new Map<string, number>();
  const itemAgg = new Map<
    string,
    { itemType: "raw" | "flavour"; itemId: string; qtyG: number; valueRupees: number }
  >();

  for (const g of grnRows) {
    if (!g.posted_at) continue;
    const key = monthKey(new Date(g.posted_at));
    const branchName = branchNameByPo.get(g.purchase_order_id) ?? "Unknown branch";
    let grnValue = 0;
    for (const l of g.grn_lines) {
      const qtyG = (l.received_qty_g ?? 0) + (l.damaged_qty_g ?? 0);
      const value = (qtyG / 1000) * (l.rate ?? 0);
      grnValue += value;

      const itemKey = `${l.item_type}|${l.item_id}`;
      const entry = itemAgg.get(itemKey) ?? {
        itemType: l.item_type,
        itemId: l.item_id,
        qtyG: 0,
        valueRupees: 0,
      };
      entry.qtyG += qtyG;
      entry.valueRupees += value;
      itemAgg.set(itemKey, entry);
    }
    spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + grnValue);
    spendByBranch.set(branchName, (spendByBranch.get(branchName) ?? 0) + grnValue);
    if (g.transportation_cost) {
      transportByMonth.set(
        key,
        (transportByMonth.get(key) ?? 0) + Number(g.transportation_cost),
      );
    }
  }

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

  const data: ReportsData = {
    monthlySpend: months.map((m) => ({
      label: m.label,
      spendRupees: spendByMonth.get(m.key) ?? 0,
      transportRupees: transportByMonth.get(m.key) ?? 0,
    })),
    itemWise: [...itemAgg.values()]
      .sort((a, b) => b.valueRupees - a.valueRupees)
      .slice(0, 15)
      .map((e) => ({
        name: nameById.get(e.itemId) ?? "Unknown item",
        type: e.itemType,
        qtyG: e.qtyG,
        valueRupees: e.valueRupees,
      })),
    branchWise: [...spendByBranch.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, valueRupees]) => ({ name, valueRupees })),
  };

  return <ReportsView data={data} />;
}
