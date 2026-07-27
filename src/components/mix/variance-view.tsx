"use client";

import { Scale, Boxes, FlaskConical, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { formatGrams } from "@/lib/units";
import { cn } from "@/lib/utils";

type DetailRow = {
  batchNo: string;
  mixedAt: string | null;
  mixedByName: string;
  materialName: string;
  materialCode: string | null;
  plannedG: number;
  actualG: number;
  varianceG: number;
};

type WeekRow = {
  key: string;
  label: string;
  plannedG: number;
  actualG: number;
  varianceG: number;
};

type MixerRow = {
  mixerName: string;
  plannedG: number;
  actualG: number;
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

export function VarianceView({
  detail,
  byWeek,
  byMixer,
}: {
  detail: DetailRow[];
  byWeek: WeekRow[];
  byMixer: MixerRow[];
}) {
  const detailColumns: DataTableColumn<DetailRow>[] = [
    { key: "batch", header: "Batch", render: (r) => r.batchNo },
    {
      key: "date",
      header: "Date",
      render: (r) =>
        r.mixedAt
          ? new Date(r.mixedAt).toLocaleDateString("en-IN", {
              dateStyle: "medium",
            })
          : "—",
    },
    { key: "mixer", header: "Mixer", render: (r) => r.mixedByName },
    {
      key: "material",
      header: "Material",
      render: (r) => (
        <>
          {r.materialName}
          {r.materialCode && (
            <span className="text-muted-foreground"> · {r.materialCode}</span>
          )}
        </>
      ),
    },
    {
      key: "planned",
      header: "Planned",
      numeric: true,
      render: (r) => formatGrams(r.plannedG),
    },
    {
      key: "actual",
      header: "Actual",
      numeric: true,
      render: (r) => formatGrams(r.actualG),
    },
    {
      key: "variance",
      header: "Variance",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  const weekColumns: DataTableColumn<WeekRow>[] = [
    { key: "week", header: "Week", render: (r) => r.label },
    {
      key: "planned",
      header: "Planned",
      numeric: true,
      render: (r) => formatGrams(r.plannedG),
    },
    {
      key: "actual",
      header: "Actual",
      numeric: true,
      render: (r) => formatGrams(r.actualG),
    },
    {
      key: "variance",
      header: "Variance",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  const mixerColumns: DataTableColumn<MixerRow>[] = [
    { key: "mixer", header: "Mixer", render: (r) => r.mixerName },
    {
      key: "planned",
      header: "Planned",
      numeric: true,
      render: (r) => formatGrams(r.plannedG),
    },
    {
      key: "actual",
      header: "Actual",
      numeric: true,
      render: (r) => formatGrams(r.actualG),
    },
    {
      key: "variance",
      header: "Variance",
      numeric: true,
      render: (r) => <VarianceCell varianceG={r.varianceG} />,
    },
  ];

  if (detail.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          title="Mixing variance"
          description="Planned vs actual grams, per batch, per material, by week and by mixer."
        />
        <EmptyState
          icon={Scale}
          title="No confirmed batches yet"
          description="Variance shows up here once batches have been mixed and confirmed."
        />
      </div>
    );
  }

  const totalVarianceG = detail.reduce((sum, r) => sum + r.varianceG, 0);
  const batchesAffected = new Set(detail.map((r) => r.batchNo)).size;
  const materialsAffected = new Set(
    detail.map((r) => r.materialCode ?? r.materialName),
  ).size;

  return (
    <div className="flex flex-col gap-8 p-6">
      <PageHeader
        title="Mixing variance"
        description="Planned vs actual grams — over-pouring and spillage, one of the four leakage sources."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Total variance"
          value={`${totalVarianceG > 0 ? "+" : ""}${formatGrams(totalVarianceG)}`}
          icon={Scale}
          tone="primary"
          className="col-span-2 sm:col-span-1"
        />
        <StatCard
          label="Batches affected"
          value={String(batchesAffected)}
          icon={Boxes}
        />
        <StatCard
          label="Materials affected"
          value={String(materialsAffected)}
          icon={FlaskConical}
        />
        <StatCard
          label="Weeks tracked"
          value={String(byWeek.length)}
          icon={CalendarDays}
        />
      </div>

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">By week</h2>
        <DataTable
          columns={weekColumns}
          data={byWeek}
          getRowKey={(r) => r.key}
        />
      </div>

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">By mixer</h2>
        <DataTable
          columns={mixerColumns}
          data={byMixer}
          getRowKey={(r) => r.mixerName}
        />
      </div>

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          By batch and material
        </h2>
        <DataTable
          columns={detailColumns}
          data={detail}
          getRowKey={(r, i) => `${r.batchNo}-${r.materialCode ?? i}`}
        />
      </div>
    </div>
  );
}
