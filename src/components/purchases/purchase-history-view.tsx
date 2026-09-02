"use client";

import * as React from "react";
import { History, Package, PackageCheck, FileText } from "lucide-react";
import {
  getPurchaseHistory,
  type PurchaseHistoryFilters,
} from "@/app/(app)/purchases/history/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatGrams } from "@/lib/units";

type Supplier = { id: string; name: string };
type RawMaterial = { id: string; code: string | null; name: string };
type RatePoint = { rate: number; date: string; source: string };

type SupplierSummary = {
  supplierId: string;
  supplierName: string;
  orderCount: number;
  totalOrderedG: number;
  totalReceivedG: number;
  lastOrderAt: string;
};

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

type HistoryData = {
  bySupplier: SupplierSummary[];
  byMaterial: MaterialSummary[];
  records: HistoryRecord[];
};

export function PurchaseHistoryView({
  suppliers,
  rawMaterials,
  initialData,
}: {
  suppliers: Supplier[];
  rawMaterials: RawMaterial[];
  initialData: HistoryData;
}) {
  const [data, setData] = React.useState(initialData);
  const [loading, setLoading] = React.useState(false);
  const [supplierId, setSupplierId] = React.useState("");
  const [rawMaterialId, setRawMaterialId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [chartMaterial, setChartMaterial] = React.useState<MaterialSummary | null>(
    null,
  );

  const applyFilters = React.useCallback(async () => {
    setLoading(true);
    const filters: PurchaseHistoryFilters = {
      supplierId: supplierId || undefined,
      rawMaterialId: rawMaterialId || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to
        ? new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString()
        : undefined,
    };
    const result = await getPurchaseHistory(filters);
    setLoading(false);
    if (result.success) setData(result.data);
  }, [supplierId, rawMaterialId, from, to]);

  const supplierColumns: DataTableColumn<SupplierSummary>[] = [
    {
      key: "supplier",
      header: "Supplier",
      cardRole: "title",
      render: (s) => s.supplierName,
    },
    {
      key: "orders",
      header: "Orders",
      numeric: true,
      render: (s) => String(s.orderCount),
    },
    {
      key: "ordered",
      header: "Total ordered",
      numeric: true,
      render: (s) => formatGrams(s.totalOrderedG),
    },
    {
      key: "received",
      header: "Total received",
      numeric: true,
      render: (s) => formatGrams(s.totalReceivedG),
    },
    {
      key: "last",
      header: "Last order",
      render: (s) => new Date(s.lastOrderAt).toLocaleDateString("en-IN"),
    },
  ];

  const materialColumns: DataTableColumn<MaterialSummary>[] = [
    {
      key: "material",
      header: "Material",
      cardRole: "title",
      render: (m) => (
        <>
          {m.name}
          {m.code && <span className="text-muted-foreground"> · {m.code}</span>}
          {m.itemType === "flavour" && (
            <span className="text-info ml-1.5 text-xs">Flavour</span>
          )}
        </>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      numeric: true,
      render: (m) => String(m.orderCount),
    },
    {
      key: "ordered",
      header: "Total ordered",
      numeric: true,
      render: (m) => formatGrams(m.totalOrderedG),
    },
    {
      key: "received",
      header: "Total received",
      numeric: true,
      render: (m) => formatGrams(m.totalReceivedG),
    },
    {
      key: "rate",
      header: "Current rate",
      numeric: true,
      render: (m) => (m.currentRate != null ? `₹${m.currentRate}` : "—"),
    },
  ];

  const recordColumns: DataTableColumn<HistoryRecord>[] = [
    {
      key: "date",
      header: "Date",
      render: (r) =>
        r.date ? new Date(r.date).toLocaleDateString("en-IN") : "—",
    },
    {
      key: "type",
      header: "Type",
      cardRole: "badge",
      render: (r) => (
        <span className="text-muted-foreground text-xs">
          {r.type === "order" ? "Order" : "Receipt"}
        </span>
      ),
    },
    { key: "supplier", header: "Supplier", render: (r) => r.supplierName },
    {
      key: "material",
      header: "Material",
      cardRole: "title",
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
      key: "qty",
      header: "Quantity",
      numeric: true,
      render: (r) => formatGrams(r.qtyG),
    },
    {
      key: "rate",
      header: "Rate",
      numeric: true,
      render: (r) => (r.rate != null ? `₹${r.rate}` : "—"),
    },
  ];

  const totalOrders = data.bySupplier.reduce((s, x) => s + x.orderCount, 0);
  const totalOrderedG = data.bySupplier.reduce((s, x) => s + x.totalOrderedG, 0);
  const totalReceivedG = data.bySupplier.reduce(
    (s, x) => s + x.totalReceivedG,
    0,
  );
  const receiptCount = data.records.filter((r) => r.type === "receipt").length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Purchase history"
        description="Every order and receipt, by supplier and by material, with rate movement over time."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Orders in view"
          value={String(totalOrders)}
          detail={`${data.bySupplier.length} supplier${data.bySupplier.length === 1 ? "" : "s"}`}
          icon={History}
          tone="primary"
          className="col-span-2 sm:col-span-1"
        />
        <StatCard
          label="Total ordered"
          value={formatGrams(totalOrderedG)}
          icon={Package}
        />
        <StatCard
          label="Total received"
          value={formatGrams(totalReceivedG)}
          icon={PackageCheck}
        />
        <StatCard
          label="Receipts (GRNs)"
          value={String(receiptCount)}
          icon={FileText}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label>Supplier</Label>
          <Select
            items={[
              { value: "", label: "All suppliers" },
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
            value={supplierId}
            onValueChange={(v) => setSupplierId(v ?? "")}
          >
            <SelectTrigger>
              <SelectValue placeholder="All suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All suppliers</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Material</Label>
          <Select
            items={[
              { value: "", label: "All materials" },
              ...rawMaterials.map((m) => ({
                value: m.id,
                label: m.code ? `${m.name} (${m.code})` : m.name,
              })),
            ]}
            value={rawMaterialId}
            onValueChange={(v) => setRawMaterialId(v ?? "")}
          >
            <SelectTrigger>
              <SelectValue placeholder="All materials" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All materials</SelectItem>
              {rawMaterials.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                  {m.code && (
                    <span className="text-muted-foreground"> ({m.code})</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <Button
        onClick={applyFilters}
        disabled={loading}
        className="justify-self-start"
      >
        {loading ? "Loading…" : "Apply filters"}
      </Button>

      <div className="grid gap-3">
        <h2 className="text-sm font-semibold">By supplier</h2>
        <DataTable
          columns={supplierColumns}
          data={data.bySupplier}
          isLoading={loading}
          getRowKey={(s) => s.supplierId}
          emptyState={
            <EmptyState
              icon={History}
              title="No orders match these filters"
              description="Try widening the date range or clearing a filter."
            />
          }
        />
      </div>

      <div className="grid gap-3">
        <h2 className="text-sm font-semibold">By material</h2>
        <DataTable
          columns={materialColumns}
          data={data.byMaterial}
          isLoading={loading}
          onRowClick={(m) => m.rateHistory.length > 0 && setChartMaterial(m)}
          getRowKey={(m) => m.rawMaterialId}
          emptyState={
            <EmptyState
              icon={History}
              title="No orders match these filters"
              description="Try widening the date range or clearing a filter."
            />
          }
        />
      </div>

      <div className="grid gap-3">
        <h2 className="text-sm font-semibold">Every order &amp; receipt</h2>
        <DataTable
          columns={recordColumns}
          data={data.records}
          isLoading={loading}
          getRowKey={(r, i) => `${r.type}-${i}`}
          emptyState={
            <EmptyState
              icon={History}
              title="Nothing to show"
              description="Orders and receipts matching these filters will show up here."
            />
          }
        />
      </div>

      <RateChartDialog
        material={chartMaterial}
        onOpenChange={(open) => !open && setChartMaterial(null)}
      />
    </div>
  );
}

function RateChartDialog({
  material,
  onOpenChange,
}: {
  material: MaterialSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!material} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{material?.name ?? "Rate movement"}</DialogTitle>
          <DialogDescription>Rate over time, most recent last.</DialogDescription>
        </DialogHeader>
        {material && <RateSparkline points={material.rateHistory} />}
      </DialogContent>
    </Dialog>
  );
}

function RateSparkline({ points }: { points: RatePoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No rate history yet.</p>
    );
  }

  const width = 480;
  const height = 160;
  const padding = 24;
  const rates = points.map((p) => p.rate);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  const range = maxRate - minRate || 1;

  const coords = points.map((p, i) => {
    const x =
      points.length === 1
        ? width / 2
        : padding + (i / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((p.rate - minRate) / range) * (height - padding * 2);
    return { x, y, point: p };
  });

  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");

  return (
    <div className="grid gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Rate movement over time"
      >
        <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="3" fill="var(--color-primary)" />
        ))}
      </svg>
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>
          {new Date(points[0].date).toLocaleDateString("en-IN")} · ₹{points[0].rate}
        </span>
        <span>
          {new Date(points[points.length - 1].date).toLocaleDateString("en-IN")} · ₹
          {points[points.length - 1].rate}
        </span>
      </div>
    </div>
  );
}
