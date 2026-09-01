import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessPurchasesTab } from "@/lib/purchases-tabs";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoodsReceivedView, type GrnRow } from "@/components/purchases/goods-received-view";

export default async function GoodsReceivedPage() {
  const session = await getSession();
  if (!session || !canAccessPurchasesTab(session.role, "/purchases/grn")) {
    redirect("/");
  }

  const admin = createAdminClient();
  let query = admin
    .from("grns")
    .select(
      "id, grn_no, status, posted_at, transportation_cost, branch_id, branches(name), purchase_orders(po_no), grn_lines(received_qty_g, damaged_qty_g, rate)",
    )
    .eq("source", "vendor");
  if (session.role !== "admin") {
    query = query.eq("branch_id", session.branchId ?? "");
  }
  const { data } = await query.order("created_at", { ascending: false }).limit(100);

  type Row = {
    id: string;
    grn_no: string;
    status: string;
    posted_at: string | null;
    transportation_cost: number | null;
    branches: { name: string } | null;
    purchase_orders: { po_no: string } | null;
    grn_lines: { received_qty_g: number | null; damaged_qty_g: number | null; rate: number | null }[];
  };

  const rows: GrnRow[] = ((data ?? []) as unknown as Row[]).map((g) => ({
    id: g.id,
    grnNo: g.grn_no,
    poNo: g.purchase_orders?.po_no ?? "—",
    branchName: g.branches?.name ?? "",
    status: g.status,
    date: g.posted_at,
    itemCount: g.grn_lines.length,
    transportCost: g.transportation_cost == null ? null : Number(g.transportation_cost),
    valueRupees: g.grn_lines.reduce(
      (sum, l) => sum + ((l.received_qty_g ?? 0) / 1000) * (l.rate ?? 0),
      0,
    ),
  }));

  return <GoodsReceivedView grns={rows} isAdmin={session.role === "admin"} />;
}
