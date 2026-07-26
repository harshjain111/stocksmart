"use client";

import * as React from "react";
import { ShoppingCart, Plus, Trash2 } from "lucide-react";
import {
  getWhatToBuyData,
  createDraftOrders,
  type ManualEntryInput,
  type BuyGroupView,
} from "@/app/(app)/buy/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { DataTable } from "@/components/shared/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatGrams, kgToGrams } from "@/lib/units";

type Option = { id: string; code: string | null; name: string };
type Branch = { id: string; name: string };
type Supplier = { id: string; name: string };

type ManualEntryDraft = ManualEntryInput & {
  name: string;
  code: string | null;
  branchName: string;
};

export function WhatToBuyView({
  branches,
  rawMaterials,
  flavours,
  suppliers,
  canCreateOrders,
}: {
  branches: Branch[];
  rawMaterials: Option[];
  flavours: Option[];
  suppliers: Supplier[];
  canCreateOrders: boolean;
}) {
  const [includeParTopUp, setIncludeParTopUp] = React.useState(false);
  const [manualEntries, setManualEntries] = React.useState<ManualEntryDraft[]>(
    [],
  );
  const [groups, setGroups] = React.useState<BuyGroupView[]>([]);
  const [issues, setIssues] = React.useState<string[]>([]);
  const [requisitionLineCount, setRequisitionLineCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [pickedSupplier, setPickedSupplier] = React.useState<
    Record<string, string>
  >({});
  const [creatingKey, setCreatingKey] = React.useState<string | null>(null);
  const [createdOrders, setCreatedOrders] = React.useState<
    { id: string; poNo: string }[]
  >([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setServerError(null);
    const result = await getWhatToBuyData(manualEntries, includeParTopUp);
    setLoading(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setGroups(result.data.groups);
    setIssues(result.data.issues);
    setRequisitionLineCount(result.data.requisitionLineCount);
  }, [manualEntries, includeParTopUp]);

  React.useEffect(() => {
    load();
  }, [load]);

  function removeManualEntry(index: number) {
    setManualEntries((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateOrder(group: BuyGroupView) {
    const supplierId = group.supplierId ?? pickedSupplier[group.key];
    if (!supplierId) return;
    setCreatingKey(group.key);
    setServerError(null);
    const result = await createDraftOrders([
      {
        supplierId,
        departmentId: group.departmentId,
        lines: group.lines.map((l) => ({
          rawMaterialId: l.rawMaterialId,
          qtyG: l.buyG,
        })),
      },
    ]);
    setCreatingKey(null);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setCreatedOrders((prev) => [...prev, ...result.data]);
    load();
  }

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="What to buy"
        description="Approved requisitions, manual entries and par top-up, grouped into draft orders by supplier."
      />

      <ManualEntryComposer
        branches={branches}
        rawMaterials={rawMaterials}
        flavours={flavours}
        onAdd={(entry) => setManualEntries((prev) => [...prev, entry])}
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="par-top-up"
              checked={includeParTopUp}
              onCheckedChange={(checked) => setIncludeParTopUp(checked === true)}
            />
            <Label htmlFor="par-top-up" className="cursor-pointer">
              Include par top-up (departments below their par level)
            </Label>
          </div>
          <p className="text-muted-foreground text-sm">
            {requisitionLineCount} approved requisition line
            {requisitionLineCount === 1 ? "" : "s"} marked buy
            {manualEntries.length > 0 &&
              `, ${manualEntries.length} manual entr${manualEntries.length === 1 ? "y" : "ies"}`}
            .
          </p>

          {manualEntries.length > 0 && (
            <div className="flex flex-col gap-1">
              {manualEntries.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                >
                  <span>
                    {entry.name}
                    {entry.code && (
                      <span className="text-muted-foreground"> · {entry.code}</span>
                    )}{" "}
                    — {formatGrams(entry.qtyG)} for {entry.branchName}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeManualEntry(i)}
                  >
                    <Trash2 className="text-destructive size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {issues.length > 0 && (
        <Card className="border-destructive/50">
          <CardContent className="grid gap-1">
            {issues.map((issue, i) => (
              <p key={i} className="text-destructive text-sm">
                {issue}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {createdOrders.length > 0 && (
        <Card className="border-primary/50">
          <CardContent>
            <p className="text-sm">
              Created:{" "}
              {createdOrders.map((o) => o.poNo).join(", ")}
            </p>
          </CardContent>
        </Card>
      )}

      {serverError && <p className="text-destructive text-sm">{serverError}</p>}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Nothing to buy right now"
          description="Approved buy-decision requisitions, manual entries or par top-up will show up here as draft orders."
        />
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <BuyGroupCard
              key={group.key}
              group={group}
              suppliers={suppliers}
              pickedSupplierId={pickedSupplier[group.key] ?? ""}
              onPickSupplier={(supplierId) =>
                setPickedSupplier((prev) => ({ ...prev, [group.key]: supplierId }))
              }
              canCreateOrders={canCreateOrders}
              isCreating={creatingKey === group.key}
              onCreate={() => handleCreateOrder(group)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BuyGroupCard({
  group,
  suppliers,
  pickedSupplierId,
  onPickSupplier,
  canCreateOrders,
  isCreating,
  onCreate,
}: {
  group: BuyGroupView;
  suppliers: Supplier[];
  pickedSupplierId: string;
  onPickSupplier: (supplierId: string) => void;
  canCreateOrders: boolean;
  isCreating: boolean;
  onCreate: () => void;
}) {
  const resolvedSupplierId = group.supplierId ?? pickedSupplierId;

  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {group.supplierName ? (
              <p className="font-medium">{group.supplierName}</p>
            ) : (
              <div className="flex items-center gap-2">
                <Label className="text-sm">Supplier</Label>
                <Select
                  items={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                  value={pickedSupplierId}
                  onValueChange={(v) => v && onPickSupplier(v)}
                >
                  <SelectTrigger className="w-56">
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
            )}
            <p className="text-muted-foreground text-sm">
              Ship to {group.departmentName}
            </p>
          </div>
          {canCreateOrders && (
            <Button
              size="sm"
              disabled={!resolvedSupplierId || isCreating}
              onClick={onCreate}
            >
              {isCreating ? "Creating…" : "Create draft order"}
            </Button>
          )}
        </div>

        <DataTable
          columns={[
            {
              key: "material",
              header: "Material",
              render: (l) => (
                <>
                  {l.rawMaterialName}
                  {l.rawMaterialCode && (
                    <span className="text-muted-foreground"> · {l.rawMaterialCode}</span>
                  )}
                </>
              ),
            },
            {
              key: "needed",
              header: "Needed",
              numeric: true,
              render: (l) => formatGrams(l.neededG),
            },
            {
              key: "have",
              header: "Have",
              numeric: true,
              render: (l) => formatGrams(l.haveG),
            },
            {
              key: "onOrder",
              header: "On order",
              numeric: true,
              render: (l) => formatGrams(l.onOrderG),
            },
            {
              key: "buy",
              header: "Buy",
              numeric: true,
              render: (l) => formatGrams(l.buyG),
            },
          ]}
          data={group.lines}
          getRowKey={(l) => l.rawMaterialId}
        />
      </CardContent>
    </Card>
  );
}

function ManualEntryComposer({
  branches,
  rawMaterials,
  flavours,
  onAdd,
}: {
  branches: Branch[];
  rawMaterials: Option[];
  flavours: Option[];
  onAdd: (entry: ManualEntryDraft) => void;
}) {
  const [branchId, setBranchId] = React.useState(branches[0]?.id ?? "");
  const [itemType, setItemType] = React.useState<"raw" | "flavour">("raw");
  const [itemKey, setItemKey] = React.useState("");
  const [qtyKg, setQtyKg] = React.useState("");

  const items = itemType === "raw" ? rawMaterials : flavours;

  function handleAdd() {
    const item = items.find((i) => i.id === itemKey);
    const branch = branches.find((b) => b.id === branchId);
    const qtyG = qtyKg ? kgToGrams(parseFloat(qtyKg)) : 0;
    if (!item || !branch || qtyG <= 0) return;
    onAdd({
      itemType,
      itemId: item.id,
      branchId: branch.id,
      qtyG,
      name: item.name,
      code: item.code,
      branchName: branch.name,
    });
    setItemKey("");
    setQtyKg("");
  }

  if (branches.length === 0) return null;

  return (
    <Card>
      <CardContent className="grid gap-4">
        <p className="text-sm font-medium">Manual entry</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:flex-wrap">
          <div className="grid gap-1.5">
            <Label>Branch</Label>
            <Select
              items={branches.map((b) => ({ value: b.id, label: b.name }))}
              value={branchId}
              onValueChange={(v) => v && setBranchId(v)}
            >
              <SelectTrigger className="w-40">
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
            <Label>Type</Label>
            <Select
              items={[
                { value: "raw", label: "Raw material" },
                { value: "flavour", label: "Flavour" },
              ]}
              value={itemType}
              onValueChange={(v) => {
                if (v) {
                  setItemType(v as "raw" | "flavour");
                  setItemKey("");
                }
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="raw">Raw material</SelectItem>
                <SelectItem value="flavour">Flavour</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid flex-1 gap-1.5">
            <Label>Item</Label>
            <Select
              items={items.map((i) => ({
                value: i.id,
                label: i.code ? `${i.name} (${i.code})` : i.name,
              }))}
              value={itemKey}
              onValueChange={(v) => v && setItemKey(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an item" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
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
          <div className="grid gap-1.5">
            <Label>Quantity (kg)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              className="font-qty w-28"
              value={qtyKg}
              onChange={(e) => setQtyKg(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            disabled={!itemKey || !qtyKg}
            onClick={handleAdd}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
