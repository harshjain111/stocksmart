"use client";

import { Scale } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { formatGrams } from "@/lib/units";
import { cn } from "@/lib/utils";

type ByRouteRow = { route: string; varianceG: number };
type ByItemRow = { name: string; code: string | null; varianceG: number };
type ByPeriodRow = { key: string; label: string; varianceG: number };
type DetailRow = {
  grnId: string;
  grnNo: string;
  transferId: string;
  transferNo: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  dispatchedAt: string | null;
  itemName: string;
  itemCode: string | null;
  dispatchedQtyG: number;
  receivedQtyG: number;
  varianceG: number;
};

function VarianceCell({ varianceG }: { varianceG: number }) {
  if (varianceG === 0) {
    return <span className="text-muted-foreground font-qty">0 g</span>;
  }
  return (
    <span
      className={cn(
        "font-qty",
        varianceG > 0 ? "text-destructive" : "text-warning-foreground",
      )}
    >
      {varianceG > 0 ? "+" : ""}
      {formatGrams(varianceG)}
    </span>
  );
}

export function TransitVarianceView({
  byRoute,
  byItem,
  byPeriod,
  detail,
}: {
  byRoute: ByRouteRow[];
  byItem: ByItemRow[];
  byPeriod: ByPeriodRow[];
  detail: DetailRow[];
}) {
  const routeColumns: DataTableColumn<ByRouteRow>[] = [
    { key: "route", header: "Route", render: (r) => r.route },
    {
      key: "variance",
      header: "Lost in transit",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  const itemColumns: DataTableColumn<ByItemRow>[] = [
    {
      key: "item",
      header: "Item",
      render: (r) => (
        <>
          {r.name}
          {r.code && <span className="text-muted-foreground"> · {r.code}</span>}
        </>
      ),
    },
    {
      key: "variance",
      header: "Lost in transit",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  const periodColumns: DataTableColumn<ByPeriodRow>[] = [
    { key: "period", header: "Week", render: (r) => r.label },
    {
      key: "variance",
      header: "Lost in transit",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  const detailColumns: DataTableColumn<DetailRow>[] = [
    { key: "transfer", header: "Transfer", render: (r) => r.transferNo },
    { key: "grn", header: "GRN", render: (r) => r.grnNo },
    {
      key: "route",
      header: "Route",
      render: (r) => `${r.fromDepartmentName} → ${r.toDepartmentName}`,
    },
    {
      key: "item",
      header: "Item",
      render: (r) => (
        <>
          {r.itemName}
          {r.itemCode && (
            <span className="text-muted-foreground"> · {r.itemCode}</span>
          )}
        </>
      ),
    },
    {
      key: "dispatched",
      header: "Dispatched",
      numeric: true,
      render: (r) => formatGrams(r.dispatchedQtyG),
    },
    {
      key: "received",
      header: "Received",
      numeric: true,
      render: (r) => formatGrams(r.receivedQtyG),
    },
    {
      key: "variance",
      header: "Lost in transit",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  if (detail.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          title="Transit variance"
          description="Dispatched vs received, by route, by item and by period."
        />
        <EmptyState
          icon={Scale}
          title="No transit loss yet"
          description="This report fills in once a GRN is posted with less received than was dispatched."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-6">
      <PageHeader
        title="Transit variance"
        description="Dispatched vs received — the third leakage source. Only posted GRNs count."
      />

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">By route</h2>
        <DataTable
          columns={routeColumns}
          data={byRoute}
          getRowKey={(r) => r.route}
        />
      </div>

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">By item</h2>
        <DataTable
          columns={itemColumns}
          data={byItem}
          getRowKey={(r, i) => `${r.name}-${i}`}
        />
      </div>

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">By period</h2>
        <DataTable
          columns={periodColumns}
          data={byPeriod}
          getRowKey={(r) => r.key}
        />
      </div>

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Detail</h2>
        <DataTable
          columns={detailColumns}
          data={detail}
          getRowKey={(r, i) => `${r.grnId}-${r.itemCode ?? i}`}
        />
      </div>
    </div>
  );
}
