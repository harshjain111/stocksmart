import { TrendingDown, TrendingUp, Minus, Users, Send, Percent } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import type { SupplierPerformance } from "@/app/(app)/buy/performance/actions";

export function SupplierPerformanceView({
  suppliers,
  onTimeDays,
}: {
  suppliers: SupplierPerformance[];
  onTimeDays: number;
}) {
  const columns: DataTableColumn<SupplierPerformance>[] = [
    { key: "supplier", header: "Supplier", render: (s) => s.supplierName },
    {
      key: "sent",
      header: "Orders sent",
      numeric: true,
      render: (s) => String(s.sentCount),
    },
    {
      key: "onTime",
      header: "On-time %",
      numeric: true,
      render: (s) =>
        s.onTimePct != null
          ? `${s.onTimePct}% (${s.onTimeCount}/${s.receivedOrderCount})`
          : "No receipts yet",
    },
    {
      key: "short",
      header: "Short-supply %",
      numeric: true,
      render: (s) =>
        s.shortSupplyPct != null
          ? `${s.shortSupplyPct}% (${s.shortOrderCount}/${s.receivedOrderCount})`
          : "—",
    },
    {
      key: "trend",
      header: "Rate trend",
      render: (s) => <RateTrend supplier={s} />,
    },
  ];

  const totalSent = suppliers.reduce((s, x) => s + x.sentCount, 0);
  const onTimeValues = suppliers
    .map((s) => s.onTimePct)
    .filter((v): v is number => v != null);
  const avgOnTimePct =
    onTimeValues.length > 0
      ? Math.round(onTimeValues.reduce((a, b) => a + b, 0) / onTimeValues.length)
      : null;
  const shortSupplyCount = suppliers.filter(
    (s) => s.shortSupplyPct != null && s.shortSupplyPct > 0,
  ).length;

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Supplier performance"
        description={`On-time = received within ${onTimeDays} days of being sent. A decision aid, not a report suite.`}
      />

      {suppliers.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            label="Suppliers tracked"
            value={String(suppliers.length)}
            detail={`${totalSent} order${totalSent === 1 ? "" : "s"} sent`}
            icon={Users}
            tone="primary"
            className="col-span-2 sm:col-span-1"
          />
          <StatCard label="Orders sent" value={String(totalSent)} icon={Send} />
          <StatCard
            label="Avg on-time"
            value={avgOnTimePct != null ? `${avgOnTimePct}%` : "—"}
            icon={Percent}
          />
          <StatCard
            label="Short on supply"
            value={String(shortSupplyCount)}
            icon={TrendingDown}
          />
        </div>
      )}

      <DataTable
        columns={columns}
        data={suppliers}
        getRowKey={(s) => s.supplierId}
        emptyState={
          <EmptyState
            icon={Users}
            title="No sent orders yet"
            description="Once purchase orders are sent to suppliers, their performance will show up here."
          />
        }
      />
    </div>
  );
}

function RateTrend({ supplier }: { supplier: SupplierPerformance }) {
  if (supplier.rateTrendPct == null) {
    return <span className="text-muted-foreground text-sm">Not enough data</span>;
  }
  const isUp = supplier.rateTrendPct > 0;
  const isDown = supplier.rateTrendPct < 0;
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
  const tone = isUp
    ? "text-destructive"
    : isDown
      ? "text-primary"
      : "text-muted-foreground";

  return (
    <span className={`flex items-center justify-end gap-1 text-sm ${tone}`}>
      <Icon className="size-4" />
      {supplier.rateTrendPct > 0 ? "+" : ""}
      {supplier.rateTrendPct}%
      <span className="text-muted-foreground">
        ({supplier.materialsTracked} material
        {supplier.materialsTracked === 1 ? "" : "s"})
      </span>
    </span>
  );
}
