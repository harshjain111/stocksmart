"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Clock, Truck, CheckCircle2, Plus, Trash2 } from "lucide-react";
import {
  getOrders,
  createManualOrder,
  type OrderFilters,
  type RawMaterialWithRate,
} from "@/app/(app)/buy/orders/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { StatCard } from "@/components/shared/stat-card";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
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
import { formatGrams, kgToGrams } from "@/lib/units";

type Branch = { id: string; name: string };
type Supplier = { id: string; name: string };

type OrderRow = {
  id: string;
  poNo: string;
  supplierName: string;
  shipToName: string;
  branchName: string;
  status: string;
  createdAt: string;
  lineCount: number;
  totalQtyG: number;
};

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partially_received", label: "Partially received" },
  { value: "received", label: "Received" },
  { value: "closed", label: "Closed" },
];

export function OrdersView({
  suppliers,
  branches,
  rawMaterials,
  initialOrders,
  isAdmin,
  canCreateOrders,
}: {
  suppliers: Supplier[];
  branches: Branch[];
  rawMaterials: RawMaterialWithRate[];
  initialOrders: OrderRow[];
  isAdmin: boolean;
  canCreateOrders: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState(initialOrders);
  const [loading, setLoading] = React.useState(false);
  const [supplierId, setSupplierId] = React.useState("");
  const [branchId, setBranchId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [showCompose, setShowCompose] = React.useState(false);

  const applyFilters = React.useCallback(async () => {
    setLoading(true);
    const filters: OrderFilters = {
      supplierId: supplierId || undefined,
      branchId: branchId || undefined,
      status: status || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to
        ? new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString()
        : undefined,
    };
    const result = await getOrders(filters);
    setLoading(false);
    if (result.success) setRows(result.data);
  }, [supplierId, branchId, status, from, to]);

  const columns: DataTableColumn<OrderRow>[] = [
    { key: "poNo", header: "Order", render: (r) => r.poNo },
    { key: "supplier", header: "Supplier", render: (r) => r.supplierName },
    { key: "shipTo", header: "Ship to", render: (r) => r.shipToName },
    ...(isAdmin
      ? [
          {
            key: "branch",
            header: "Branch",
            render: (r: OrderRow) => r.branchName,
          } as DataTableColumn<OrderRow>,
        ]
      : []),
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusTag status={r.status} />,
    },
    {
      key: "lines",
      header: "Lines",
      numeric: true,
      render: (r) => String(r.lineCount),
    },
    {
      key: "qty",
      header: "Total qty",
      numeric: true,
      render: (r) => formatGrams(r.totalQtyG),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (r) => new Date(r.createdAt).toLocaleDateString("en-IN"),
    },
  ];

  const statusCounts = React.useMemo(() => {
    const draft = rows.filter((r) => r.status === "draft").length;
    const sent = rows.filter((r) => r.status === "sent").length;
    const open = rows.filter(
      (r) =>
        r.status === "draft" ||
        r.status === "sent" ||
        r.status === "partially_received",
    ).length;
    const received = rows.filter(
      (r) => r.status === "received" || r.status === "closed",
    ).length;
    return { draft, sent, open, received };
  }, [rows]);

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Orders"
        description="Filter by supplier, status, ship-to branch and date."
        action={
          canCreateOrders && (
            <Button size="sm" onClick={() => setShowCompose(true)}>
              <Plus className="size-4" />
              New order
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Open orders"
          value={String(statusCounts.open)}
          detail={`of ${rows.length} shown`}
          icon={ShoppingCart}
          tone="primary"
          className="col-span-2 sm:col-span-1"
        />
        <StatCard label="Draft" value={String(statusCounts.draft)} icon={Clock} />
        <StatCard label="Sent" value={String(statusCounts.sent)} icon={Truck} />
        <StatCard
          label="Received"
          value={String(statusCounts.received)}
          icon={CheckCircle2}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
          <Label>Status</Label>
          <Select
            items={[{ value: "", label: "All statuses" }, ...STATUS_OPTIONS]}
            value={status}
            onValueChange={(v) => setStatus(v ?? "")}
          >
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isAdmin && (
          <div className="grid gap-1.5">
            <Label>Branch</Label>
            <Select
              items={[
                { value: "", label: "All branches" },
                ...branches.map((b) => ({ value: b.id, label: b.name })),
              ]}
              value={branchId}
              onValueChange={(v) => setBranchId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="from">Created from</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to">Created to</Label>
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

      <DataTable
        columns={columns}
        data={rows}
        isLoading={loading}
        onRowClick={(r) => router.push(`/buy/orders/${r.id}`)}
        getRowKey={(r) => r.id}
        emptyState={
          <EmptyState
            icon={ShoppingCart}
            title="No orders match these filters"
            description="Try widening the date range or clearing a filter."
          />
        }
      />

      <ComposeOrderDialog
        open={showCompose}
        onOpenChange={setShowCompose}
        branches={branches}
        suppliers={suppliers}
        rawMaterials={rawMaterials}
        onCreated={() => {
          setShowCompose(false);
          applyFilters();
        }}
      />
    </div>
  );
}

type ComposedLine = {
  rawMaterialId: string;
  name: string;
  code: string | null;
  qtyKg: string;
  rate: string;
};

function ComposeOrderDialog({
  open,
  onOpenChange,
  branches,
  suppliers,
  rawMaterials,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Branch[];
  suppliers: Supplier[];
  rawMaterials: RawMaterialWithRate[];
  onCreated: () => void;
}) {
  const [branchId, setBranchId] = React.useState(branches[0]?.id ?? "");
  const [supplierId, setSupplierId] = React.useState("");
  const [lines, setLines] = React.useState<ComposedLine[]>([]);
  const [pickedItemId, setPickedItemId] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setBranchId(branches[0]?.id ?? "");
      setSupplierId("");
      setLines([]);
      setPickedItemId("");
      setServerError(null);
    }
  }, [open, branches]);

  const pickableItems = rawMaterials.filter(
    (m) => !lines.some((l) => l.rawMaterialId === m.id),
  );

  function addLine() {
    const item = rawMaterials.find((m) => m.id === pickedItemId);
    if (!item) return;
    setLines((prev) => [
      ...prev,
      {
        rawMaterialId: item.id,
        name: item.name,
        code: item.code,
        qtyKg: "",
        rate: item.lastRate != null ? String(item.lastRate) : "",
      },
    ]);
    setPickedItemId("");
  }

  function removeLine(rawMaterialId: string) {
    setLines((prev) => prev.filter((l) => l.rawMaterialId !== rawMaterialId));
  }

  function updateLine(
    rawMaterialId: string,
    field: "qtyKg" | "rate",
    value: string,
  ) {
    setLines((prev) =>
      prev.map((l) => (l.rawMaterialId === rawMaterialId ? { ...l, [field]: value } : l)),
    );
  }

  const canSave =
    !!branchId &&
    !!supplierId &&
    lines.length > 0 &&
    lines.every((l) => l.qtyKg && parseFloat(l.qtyKg) > 0);

  async function handleSave() {
    if (!canSave) return;
    setServerError(null);
    setIsSubmitting(true);
    const result = await createManualOrder({
      branchId,
      supplierId,
      lines: lines.map((l) => ({
        rawMaterialId: l.rawMaterialId,
        qtyG: kgToGrams(parseFloat(l.qtyKg)),
        rate: l.rate.trim() === "" ? null : parseFloat(l.rate),
      })),
    });
    setIsSubmitting(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>
            A draft order — rates pre-fill from the last known rate and stay
            editable. A blank rate is valid.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Branch (ships to that branch&apos;s godown)</Label>
              <Select
                items={branches.map((b) => ({ value: b.id, label: b.name }))}
                value={branchId}
                onValueChange={(v) => v && setBranchId(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Supplier</Label>
              <Select
                items={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                value={supplierId}
                onValueChange={(v) => v && setSupplierId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-1.5">
              <Label>Item</Label>
              <Select
                items={pickableItems.map((i) => ({
                  value: i.id,
                  label: i.code ? `${i.name} (${i.code})` : i.name,
                }))}
                value={pickedItemId}
                onValueChange={(v) => v && setPickedItemId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a raw material" />
                </SelectTrigger>
                <SelectContent>
                  {pickableItems.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                      {i.code && (
                        <span className="text-muted-foreground"> ({i.code})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" disabled={!pickedItemId} onClick={addLine}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>

          {lines.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                      Item
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                      Quantity (kg)
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                      Rate
                    </th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.rawMaterialId} className="border-b last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {line.name}
                        {line.code && (
                          <span className="text-muted-foreground"> · {line.code}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0"
                          className="font-qty ml-auto w-24 text-right"
                          value={line.qtyKg}
                          onChange={(e) =>
                            updateLine(line.rawMaterialId, "qtyKg", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          placeholder="Blank"
                          className="ml-auto w-24 text-right"
                          value={line.rate}
                          onChange={(e) =>
                            updateLine(line.rawMaterialId, "rate", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(line.rawMaterialId)}
                        >
                          <Trash2 className="text-destructive size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}

          <div className="flex gap-2">
            <Button disabled={!canSave || isSubmitting} onClick={handleSave}>
              {isSubmitting ? "Creating…" : "Create draft order"}
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
