import Link from "next/link";
import {
  ShoppingBag,
  ClipboardList,
  Truck,
  PackageSearch,
  CheckCircle2,
  IndianRupee,
  CalendarClock,
  TrendingUp,
  AlertCircle,
  ArrowRight,
  Eye,
  Download,
  Plus,
  FileText,
  Import,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { StatusTag } from "@/components/shared/status-tag";
import { cn } from "@/lib/utils";

export type OverviewData = {
  kpis: {
    toOrder: { count: number; worthRupees: number };
    ordered: { count: number; worthRupees: number };
    inTransit: { count: number; worthRupees: number };
    partiallyReceived: { count: number; worthRupees: number };
    receivedThisMonth: { count: number; worthRupees: number };
    purchaseValueThisMonth: number;
    transportationCostThisMonth: number;
    avgLeadTimeDays: number | null;
    supplierPerformancePct: number | null;
  };
  pipeline: {
    toOrder: number;
    ordered: number;
    inTransit: number;
    partiallyReceived: number;
    received: number;
  };
  attentionItems: { label: string; tone: "destructive" | "warning" | "success" }[];
  recentOrders: {
    id: string;
    poNo: string;
    itemCount: number;
    orderDate: string;
    expectedDate: string | null;
    daysLeft: number | null;
    status: string;
    valueRupees: number;
  }[];
  recentGrns: {
    id: string;
    grnNo: string;
    poNo: string;
    date: string | null;
    itemCount: number;
    transportCost: number | null;
    valueRupees: number;
  }[];
  topPurchasedItems: {
    name: string;
    type: "raw" | "flavour";
    qtyG: number;
    valueRupees: number;
  }[];
  purchaseSummary: {
    rawValueRupees: number;
    flavourValueRupees: number;
    totalRupees: number;
    vsLastMonthPct: number | null;
  };
};

function formatRupees(value: number): string {
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

function formatKg(grams: number): string {
  return `${(grams / 1000).toFixed(0)} kg`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const TONE_CLASSES: Record<string, string> = {
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  primary: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
};

function KpiCard({
  icon: Icon,
  tone,
  value,
  label,
  detail,
  href,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  value: string;
  label: string;
  detail?: string;
  href?: string;
}) {
  const content = (
    <div className="bg-card flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/30">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", TONE_CLASSES[tone])}>
        <Icon className="size-5" />
      </span>
      <div>
        <p className="font-heading text-2xl leading-none font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{label}</p>
        {detail && <p className="text-muted-foreground text-xs">{detail}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export function OverviewView({ data }: { data: OverviewData }) {
  const { kpis, pipeline, attentionItems, recentOrders, recentGrns, topPurchasedItems, purchaseSummary } = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={ShoppingBag}
          tone="info"
          value={String(kpis.toOrder.count)}
          label="To Order"
          detail={`Worth ${formatRupees(kpis.toOrder.worthRupees)}`}
          href="/purchases/orders?status=draft"
        />
        <KpiCard
          icon={ClipboardList}
          tone="primary"
          value={String(kpis.ordered.count)}
          label="Orders Placed"
          detail={`Worth ${formatRupees(kpis.ordered.worthRupees)}`}
          href="/purchases/orders?status=sent"
        />
        <KpiCard
          icon={Truck}
          tone="warning"
          value={String(kpis.inTransit.count)}
          label="In Transit"
          detail={`Worth ${formatRupees(kpis.inTransit.worthRupees)}`}
          href="/purchases/orders?status=sent"
        />
        <KpiCard
          icon={PackageSearch}
          tone="info"
          value={String(kpis.partiallyReceived.count)}
          label="Partially Received"
          detail={`Worth ${formatRupees(kpis.partiallyReceived.worthRupees)}`}
          href="/purchases/orders?status=partially_received"
        />
        <KpiCard
          icon={CheckCircle2}
          tone="success"
          value={String(kpis.receivedThisMonth.count)}
          label="Received (This Month)"
          detail={`Worth ${formatRupees(kpis.receivedThisMonth.worthRupees)}`}
          href="/purchases/orders?status=received"
        />
        <KpiCard
          icon={IndianRupee}
          tone="destructive"
          value={formatRupees(kpis.purchaseValueThisMonth)}
          label="Purchase Value (This Month)"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_2fr]">
        <KpiCard
          icon={Truck}
          tone="info"
          value={formatRupees(kpis.transportationCostThisMonth)}
          label="Transportation Cost (This Month)"
        />
        <KpiCard
          icon={CalendarClock}
          tone="success"
          value={kpis.avgLeadTimeDays != null ? `${kpis.avgLeadTimeDays.toFixed(1)} Days` : "—"}
          label="Avg. Lead Time"
        />
        <KpiCard
          icon={TrendingUp}
          tone="success"
          value={kpis.supplierPerformancePct != null ? `${kpis.supplierPerformancePct}%` : "—"}
          label="Supplier Performance (Avg.)"
        />

        <div className="bg-card rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <AlertCircle className="text-info size-4" /> Needs Attention
            </p>
            <Link
              href="/purchases/orders"
              className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {attentionItems.length === 0 ? (
            <p className="text-muted-foreground text-sm">Everything is on track.</p>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {attentionItems.map((a) => (
                <p key={a.label} className="flex items-center gap-2 text-sm">
                  <span
                    className={cn(
                      "inline-block size-1.5 shrink-0 rounded-full",
                      a.tone === "destructive" && "bg-destructive",
                      a.tone === "warning" && "bg-warning",
                      a.tone === "success" && "bg-success",
                    )}
                  />
                  {a.label}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg border p-4">
        <p className="mb-3 text-sm font-medium">Purchase Pipeline</p>
        <div className="flex flex-wrap items-center gap-3">
          {[
            { icon: ShoppingBag, tone: "info" as const, label: "To Order", value: pipeline.toOrder },
            { icon: ClipboardList, tone: "primary" as const, label: "Ordered", value: pipeline.ordered },
            { icon: Truck, tone: "warning" as const, label: "In Transit", value: pipeline.inTransit },
            {
              icon: PackageSearch,
              tone: "info" as const,
              label: "Partially Received",
              value: pipeline.partiallyReceived,
            },
            { icon: CheckCircle2, tone: "success" as const, label: "Received", value: pipeline.received },
          ].map((stage, i, arr) => (
            <div key={stage.label} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    TONE_CLASSES[stage.tone],
                  )}
                >
                  <stage.icon className="size-4" />
                </span>
                <div>
                  <p className="text-muted-foreground text-xs">{stage.label}</p>
                  <p className="font-qty text-lg leading-none">{stage.value}</p>
                </div>
              </div>
              {i < arr.length - 1 && <ArrowRight className="text-border size-4 shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card rounded-lg border">
          <div className="flex items-center justify-between border-b p-4">
            <p className="text-sm font-medium">Recent Purchase Orders</p>
            <Link
              href="/purchases/orders"
              className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">No purchase orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="px-4 py-2 font-medium">PO Number</th>
                    <th className="px-4 py-2 font-medium">Items</th>
                    <th className="px-4 py-2 font-medium">Expected</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/purchases/orders/${o.id}`} className="text-primary font-medium hover:underline">
                          {o.poNo}
                        </Link>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{o.itemCount} items</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {fmtDate(o.expectedDate)}
                        {o.daysLeft != null && (
                          <span
                            className={cn(
                              "block text-xs",
                              o.daysLeft < 0 ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {o.daysLeft < 0
                              ? `${Math.abs(o.daysLeft)} days overdue`
                              : `${o.daysLeft} days left`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusTag status={o.status} />
                      </td>
                      <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                        {formatRupees(o.valueRupees)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/purchases/orders/${o.id}`} className="text-muted-foreground hover:text-foreground">
                            <Eye className="size-4" />
                          </Link>
                          <Link
                            href={`/purchases/orders/${o.id}/print`}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Download className="size-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-card rounded-lg border">
          <div className="flex items-center justify-between border-b p-4">
            <p className="text-sm font-medium">Recent GRNs</p>
            <Link
              href="/purchases/grn"
              className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {recentGrns.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">No goods received yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="px-4 py-2 font-medium">GRN Number</th>
                    <th className="px-4 py-2 font-medium">PO Number</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 text-right font-medium">Transport</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {recentGrns.map((g) => (
                    <tr key={g.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{g.grnNo}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{g.poNo}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDate(g.date)}</td>
                      <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                        {g.transportCost != null ? formatRupees(g.transportCost) : "—"}
                      </td>
                      <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                        {formatRupees(g.valueRupees)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1.2fr_1fr]">
        <div className="bg-card rounded-lg border p-4">
          <p className="mb-3 text-sm font-medium">Quick Actions</p>
          <div className="grid grid-cols-2 gap-2">
            <QuickAction icon={Plus} tone="success" title="Create PO" subtitle="Create new purchase order" href="/purchases/create" />
            <QuickAction icon={FileText} tone="info" title="Create GRN" subtitle="Record goods received" href="/send-receive/receive" />
            <QuickAction
              icon={Import}
              tone="info"
              title="Import Requisitions"
              subtitle="Create PO from approved requisitions"
              href="/purchases/create"
            />
            <QuickAction icon={BarChart3} tone="warning" title="Purchase Reports" subtitle="View analytics and reports" href="/purchases/reports" />
          </div>
        </div>

        <div className="bg-card rounded-lg border">
          <div className="flex items-center justify-between border-b p-4">
            <p className="text-sm font-medium">Top Purchased Items (This Month)</p>
            <Link
              href="/purchases/history"
              className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {topPurchasedItems.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">Nothing purchased yet this month.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Quantity</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {topPurchasedItems.map((item) => (
                  <tr key={item.name + item.type} className="border-b last:border-0">
                    <td className="px-4 py-2">{item.name}</td>
                    <td className="text-muted-foreground px-4 py-2 capitalize">
                      {item.type === "raw" ? "Raw Material" : "Flavour"}
                    </td>
                    <td className="font-qty px-4 py-2 text-right whitespace-nowrap">{formatKg(item.qtyG)}</td>
                    <td className="font-qty px-4 py-2 text-right whitespace-nowrap">{formatRupees(item.valueRupees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-card rounded-lg border p-4">
          <p className="mb-3 text-sm font-medium">Purchase Summary (This Month)</p>
          <PurchaseSummaryDonut summary={purchaseSummary} />
        </div>
      </div>

      <p className="text-muted-foreground text-center text-xs">
        All values are calculated based on approved POs and posted GRNs.
      </p>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  tone,
  title,
  subtitle,
  href,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  title: string;
  subtitle: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/30"
    >
      <span className={cn("flex size-8 items-center justify-center rounded-lg", TONE_CLASSES[tone])}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{subtitle}</p>
      </div>
    </Link>
  );
}

// Two-segment donut (Raw Materials / Flavours) — this schema doesn't model
// a "Packaging"/"Others" purchase category, only raw materials and
// flavours, so the mockup's four-way split is simplified to the two
// categories that actually exist rather than inventing data.
const DONUT_RADIUS = 15.915;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function PurchaseSummaryDonut({
  summary,
}: {
  summary: OverviewData["purchaseSummary"];
}) {
  const total = summary.totalRupees;
  const segments = [
    { label: "Raw Materials", value: summary.rawValueRupees, colorClass: "stroke-primary", dotClass: "bg-primary" },
    { label: "Flavours", value: summary.flavourValueRupees, colorClass: "stroke-info", dotClass: "bg-info" },
  ].filter((s) => s.value > 0);

  let cumulative = 0;
  const arcs = segments.map((s) => {
    const pct = total > 0 ? (s.value / total) * 100 : 0;
    const offset = cumulative;
    cumulative += pct;
    return { ...s, pct, offset };
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 36 36" className="size-24 shrink-0 -rotate-90" role="img" aria-label="Purchase summary">
        <circle cx="18" cy="18" r={DONUT_RADIUS} fill="none" className="stroke-muted" strokeWidth="4" />
        {arcs.map((a) => (
          <circle
            key={a.label}
            cx="18"
            cy="18"
            r={DONUT_RADIUS}
            fill="none"
            strokeWidth="4"
            className={cn(a.colorClass, "transition-all")}
            strokeDasharray={`${(a.pct / 100) * DONUT_CIRCUMFERENCE} ${DONUT_CIRCUMFERENCE}`}
            strokeDashoffset={-(a.offset / 100) * DONUT_CIRCUMFERENCE}
          />
        ))}
      </svg>
      <div className="grid gap-1.5">
        {arcs.map((a) => (
          <div key={a.label} className="flex items-center gap-1.5 text-xs">
            <span className={cn("size-2 shrink-0 rounded-full", a.dotClass)} />
            <span className="text-muted-foreground">{a.label}</span>
            <span className="font-qty">{formatRupees(a.value)}</span>
          </div>
        ))}
        <p className="font-heading mt-1 text-lg font-semibold">{formatRupees(total)}</p>
        <p className="text-muted-foreground text-xs">Total Spend</p>
        {summary.vsLastMonthPct != null && (
          <p className={cn("text-xs font-medium", summary.vsLastMonthPct <= 0 ? "text-success" : "text-destructive")}>
            {summary.vsLastMonthPct <= 0 ? "↓" : "↑"} {Math.abs(summary.vsLastMonthPct)}% vs last month
          </p>
        )}
      </div>
    </div>
  );
}
