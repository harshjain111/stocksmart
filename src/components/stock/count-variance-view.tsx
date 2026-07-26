"use client";

import Link from "next/link";
import { Scale } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { formatGrams } from "@/lib/units";
import { cn } from "@/lib/utils";

type ByDepartmentRow = { name: string; varianceG: number };
type ByItemRow = { name: string; code: string | null; varianceG: number };
type ByPeriodRow = { key: string; label: string; varianceG: number };
type DetailRow = {
  countId: string;
  countNo: string;
  departmentName: string;
  approvedAt: string | null;
  itemName: string;
  itemCode: string | null;
  systemQtyG: number;
  countedQtyG: number;
  varianceG: number;
  reason: string | null;
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

export function CountVarianceView({
  byDepartment,
  byItem,
  byPeriod,
  detail,
}: {
  byDepartment: ByDepartmentRow[];
  byItem: ByItemRow[];
  byPeriod: ByPeriodRow[];
  detail: DetailRow[];
}) {
  const departmentColumns: DataTableColumn<ByDepartmentRow>[] = [
    { key: "name", header: "Department", render: (r) => r.name },
    {
      key: "variance",
      header: "Variance",
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
      header: "Variance",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  const periodColumns: DataTableColumn<ByPeriodRow>[] = [
    { key: "period", header: "Week", render: (r) => r.label },
    {
      key: "variance",
      header: "Variance",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  const detailColumns: DataTableColumn<DetailRow>[] = [
    {
      key: "count",
      header: "Count",
      render: (r) => (
        <Link
          href={`/stock/count/${r.countId}`}
          className="text-primary hover:underline"
        >
          {r.countNo}
        </Link>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (r) => r.departmentName,
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
      key: "system",
      header: "System",
      numeric: true,
      render: (r) => formatGrams(r.systemQtyG),
    },
    {
      key: "counted",
      header: "Counted",
      numeric: true,
      render: (r) => formatGrams(r.countedQtyG),
    },
    {
      key: "variance",
      header: "Variance",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
    { key: "reason", header: "Reason", render: (r) => r.reason ?? "—" },
  ];

  if (detail.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          title="Count variance"
          description="System vs physical, by department, by item and by period."
        />
        <EmptyState
          icon={Scale}
          title="No approved counts with differences yet"
          description="This report fills in once counts are approved with a real difference."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-6">
      <PageHeader
        title="Count variance"
        description="System vs physical — the fourth leakage source. Only approved counts count."
      />

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">By department</h2>
        <DataTable
          columns={departmentColumns}
          data={byDepartment}
          getRowKey={(r) => r.name}
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
          getRowKey={(r, i) => `${r.countId}-${r.itemCode ?? i}`}
        />
      </div>
    </div>
  );
}
