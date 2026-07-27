"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, FileEdit, Plus, Send, Trash2 } from "lucide-react";
import {
  getAvailableItems,
  createRequisition,
  getRequisitionDetail,
  updateRequisitionLineQty,
  addRequisitionLine,
  submitRequisition,
} from "@/app/(app)/requisitions/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatGrams, kgToGrams } from "@/lib/units";

type Department = { id: string; name: string; branchId: string };

type RequisitionSummary = {
  id: string;
  reqNo: string;
  status: string;
  neededBy: string;
  lineCount: number;
  createdAt: string;
};

type AvailableItem = {
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  currentStockG: number;
};

type ComposedLine = {
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  currentStockG: number;
  qtyKg: string;
};

type DetailLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  qtyG: number;
  decision: string | null;
  approvedQtyG: number | null;
  decisionNote: string | null;
};

type RequisitionDetail = {
  id: string;
  reqNo: string;
  status: string;
  neededBy: string;
  note: string | null;
  lines: DetailLine[];
};

export function RequisitionsMineView({
  departments,
  requisitions,
}: {
  departments: Department[];
  requisitions: RequisitionSummary[];
}) {
  const router = useRouter();
  const [view, setView] = React.useState<"list" | "compose" | "detail">("list");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  if (departments.length === 0) {
    return (
      <div className="grid gap-6 p-6">
        <PageHeader title="My requisitions" />
        <EmptyState
          icon={ClipboardList}
          title="No department assigned"
          description="Ask an admin to assign you to a department under Setup > People before raising a requisition."
        />
      </div>
    );
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setView("detail");
  }

  function startCompose() {
    setSelectedId(null);
    setView("compose");
  }

  function onCreated(id: string) {
    router.refresh();
    openDetail(id);
  }

  const draftCount = requisitions.filter((r) => r.status === "draft").length;
  const submittedCount = requisitions.filter(
    (r) => r.status === "submitted",
  ).length;

  return (
    <div className="grid gap-6 p-6">
      {view === "list" && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            label="My requisitions"
            value={String(requisitions.length)}
            icon={ClipboardList}
            tone="primary"
            className="col-span-2 sm:col-span-1"
          />
          <StatCard label="Draft" value={String(draftCount)} icon={FileEdit} />
          <StatCard
            label="Submitted"
            value={String(submittedCount)}
            icon={Send}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="grid gap-4 lg:order-1">
          <PageHeader
            title="My requisitions"
            action={
              <Button size="sm" onClick={startCompose}>
                <Plus className="size-4" />
                New requisition
              </Button>
            }
          />
          <div className="grid gap-2">
            {requisitions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing raised yet — start a new requisition.
              </p>
            ) : (
              requisitions.map((r) => (
                <button
                  key={r.id}
                  onClick={() => openDetail(r.id)}
                  className={cn(
                    "hover:bg-muted flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
                    selectedId === r.id &&
                      view === "detail" &&
                      "border-primary",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.reqNo}</span>
                    <StatusTag status={r.status} />
                  </div>
                  <div className="text-muted-foreground flex items-center justify-between text-xs">
                    <span>
                      {r.lineCount} item{r.lineCount === 1 ? "" : "s"}
                    </span>
                    <span>
                      Needed {new Date(r.neededBy).toLocaleDateString("en-IN")}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:order-2">
          {view === "compose" && (
            <ComposeRequisition
              departments={departments}
              onCancel={() => setView(selectedId ? "detail" : "list")}
              onCreated={onCreated}
            />
          )}
          {view === "detail" && selectedId && (
            <RequisitionDetailPanel
              requisitionId={selectedId}
              onChange={() => router.refresh()}
            />
          )}
          {view === "list" && (
            <div className="text-muted-foreground flex h-full items-center justify-center rounded-lg border border-dashed p-16 text-center text-sm">
              Select a requisition from the list, or start a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComposeRequisition({
  departments,
  onCancel,
  onCreated,
}: {
  departments: Department[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [departmentId, setDepartmentId] = React.useState(
    departments[0]?.id ?? "",
  );
  const [neededBy, setNeededBy] = React.useState("");
  const [availableItems, setAvailableItems] = React.useState<AvailableItem[]>(
    [],
  );
  const [loadingItems, setLoadingItems] = React.useState(true);
  const [pickedItemKey, setPickedItemKey] = React.useState("");
  const [pickedQtyKg, setPickedQtyKg] = React.useState("");
  const [lines, setLines] = React.useState<ComposedLine[]>([]);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const loadItems = React.useCallback(async (deptId: string) => {
    setLoadingItems(true);
    const result = await getAvailableItems(deptId);
    setLoadingItems(false);
    setAvailableItems(result.success ? result.data : []);
  }, []);

  React.useEffect(() => {
    if (departmentId) loadItems(departmentId);
    setLines([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  const pickableItems = availableItems.filter(
    (item) => !lines.some((l) => l.itemId === item.itemId),
  );

  function addLine() {
    const item = availableItems.find(
      (i) => `${i.itemType}|${i.itemId}` === pickedItemKey,
    );
    const qtyG = pickedQtyKg ? kgToGrams(parseFloat(pickedQtyKg)) : 0;
    if (!item || qtyG <= 0) return;
    setLines((prev) => [
      ...prev,
      {
        itemType: item.itemType,
        itemId: item.itemId,
        name: item.name,
        code: item.code,
        currentStockG: item.currentStockG,
        qtyKg: pickedQtyKg,
      },
    ]);
    setPickedItemKey("");
    setPickedQtyKg("");
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  const canSave = !!departmentId && !!neededBy && lines.length > 0;

  async function handleSave() {
    if (!canSave) return;
    setServerError(null);
    setIsSubmitting(true);
    const result = await createRequisition({
      departmentId,
      neededBy: new Date(neededBy).toISOString(),
      lines: lines.map((l) => ({
        itemType: l.itemType,
        itemId: l.itemId,
        qtyG: kgToGrams(parseFloat(l.qtyKg)),
      })),
    });
    setIsSubmitting(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    onCreated(result.data.requisitionId);
  }

  return (
    <div className="grid gap-4">
      <PageHeader title="New requisition" />
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Department</Label>
            <Select
              items={departments.map((d) => ({ value: d.id, label: d.name }))}
              value={departmentId}
              onValueChange={(v) => v && setDepartmentId(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="needed-by">Needed by</Label>
            <Input
              id="needed-by"
              type="date"
              value={neededBy}
              onChange={(e) => setNeededBy(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4">
          {loadingItems ? (
            <Skeleton className="h-10 w-full" />
          ) : availableItems.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              This department doesn&apos;t hold any raw materials or flavours
              yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="grid flex-1 gap-1.5">
                <Label>Item</Label>
                <Select
                  items={pickableItems.map((i) => ({
                    value: `${i.itemType}|${i.itemId}`,
                    label: i.code ? `${i.name} (${i.code})` : i.name,
                  }))}
                  value={pickedItemKey}
                  onValueChange={(v) => v && setPickedItemKey(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an item" />
                  </SelectTrigger>
                  <SelectContent>
                    {pickableItems.map((i) => (
                      <SelectItem
                        key={`${i.itemType}|${i.itemId}`}
                        value={`${i.itemType}|${i.itemId}`}
                      >
                        {i.name}
                        {i.code && (
                          <span className="text-muted-foreground">
                            {" "}
                            ({i.code})
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {" "}
                          · have {formatGrams(i.currentStockG)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="qty-kg">Quantity (kg)</Label>
                <Input
                  id="qty-kg"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  className="font-qty w-28"
                  value={pickedQtyKg}
                  onChange={(e) => setPickedQtyKg(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                disabled={!pickedItemKey || !pickedQtyKg}
                onClick={addLine}
              >
                Add
              </Button>
            </div>
          )}

          {lines.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                      Item
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                      Current stock
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                      Requesting
                    </th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.itemId} className="border-b last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {line.name}
                        {line.code && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {line.code}
                          </span>
                        )}
                      </td>
                      <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                        {formatGrams(line.currentStockG)}
                      </td>
                      <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                        {line.qtyKg} kg
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(line.itemId)}
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
              {isSubmitting ? "Saving…" : "Save as draft"}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RequisitionDetailPanel({
  requisitionId,
  onChange,
}: {
  requisitionId: string;
  onChange: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<RequisitionDetail | null>(null);
  const [availableItems, setAvailableItems] = React.useState<AvailableItem[]>(
    [],
  );
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [savedLineIds, setSavedLineIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [pickedItemKey, setPickedItemKey] = React.useState("");
  const [pickedQtyKg, setPickedQtyKg] = React.useState("");
  const [isAdding, setIsAdding] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setServerError(null);
    const result = await getRequisitionDetail(requisitionId);
    setLoading(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setDetail(result.data);
    setValues(
      Object.fromEntries(
        result.data.lines.map((l) => [l.id, String(l.qtyG / 1000)]),
      ),
    );
    if (result.data.status === "draft") {
      const itemsResult = await getAvailableItems(result.data.departmentId);
      setAvailableItems(itemsResult.success ? itemsResult.data : []);
    }
  }, [requisitionId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function handleQtyBlur(lineId: string) {
    if (!detail || detail.status !== "draft") return;
    const value = values[lineId] ?? "";
    const qtyG = value.trim() === "" ? 0 : kgToGrams(parseFloat(value));
    if (qtyG <= 0) return;
    const result = await updateRequisitionLineQty(lineId, qtyG);
    if (result.success) {
      setSavedLineIds((prev) => new Set(prev).add(lineId));
      setTimeout(
        () =>
          setSavedLineIds((prev) => {
            const next = new Set(prev);
            next.delete(lineId);
            return next;
          }),
        1500,
      );
    }
  }

  async function handleAddLine() {
    if (!detail || !pickedItemKey || !pickedQtyKg) return;
    const [itemType, itemId] = pickedItemKey.split("|") as [
      "raw" | "flavour",
      string,
    ];
    const qtyG = kgToGrams(parseFloat(pickedQtyKg));
    if (qtyG <= 0) return;
    setIsAdding(true);
    setServerError(null);
    const result = await addRequisitionLine(detail.id, itemType, itemId, qtyG);
    setIsAdding(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setPickedItemKey("");
    setPickedQtyKg("");
    onChange();
    load();
  }

  async function handleSubmit() {
    if (!detail) return;
    setServerError(null);
    setIsSubmitting(true);
    const result = await submitRequisition(detail.id);
    setIsSubmitting(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    onChange();
    load();
  }

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (!detail) {
    return (
      <p className="text-destructive text-sm">
        {serverError ?? "Requisition not found."}
      </p>
    );
  }

  const isDraft = detail.status === "draft";

  return (
    <div className="grid gap-4">
      <PageHeader
        title={detail.reqNo}
        description={`Needed by ${new Date(detail.neededBy).toLocaleDateString("en-IN")}`}
        action={<StatusTag status={detail.status} />}
      />

      <Card>
        <CardContent className="grid gap-4">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                    Item
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Requested
                  </th>
                  {!isDraft && (
                    <>
                      <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                        Decision
                      </th>
                      <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                        Approved
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {line.name}
                      {line.code && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {line.code}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isDraft ? (
                        <>
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0"
                            className="font-qty ml-auto w-28 text-right"
                            value={values[line.id] ?? ""}
                            onChange={(e) =>
                              setValues((prev) => ({
                                ...prev,
                                [line.id]: e.target.value,
                              }))
                            }
                            onBlur={() => handleQtyBlur(line.id)}
                          />
                          {savedLineIds.has(line.id) && (
                            <span className="text-primary block text-xs">
                              Saved
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="font-qty whitespace-nowrap">
                          {formatGrams(line.qtyG)}
                        </span>
                      )}
                    </td>
                    {!isDraft && (
                      <>
                        <td className="px-3 py-2">
                          {line.decision ? (
                            <StatusTag
                              status={line.decision}
                              tone={
                                line.decision === "rejected"
                                  ? "destructive"
                                  : "primary"
                              }
                            />
                          ) : (
                            <span className="text-muted-foreground">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                          {line.approvedQtyG != null
                            ? formatGrams(line.approvedQtyG)
                            : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isDraft && (
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
              <div className="grid flex-1 gap-1.5">
                <Label>Add another item</Label>
                <Select
                  items={availableItems
                    .filter(
                      (i) => !detail.lines.some((l) => l.itemId === i.itemId),
                    )
                    .map((i) => ({
                      value: `${i.itemType}|${i.itemId}`,
                      label: i.code ? `${i.name} (${i.code})` : i.name,
                    }))}
                  value={pickedItemKey}
                  onValueChange={(v) => v && setPickedItemKey(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an item" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableItems
                      .filter(
                        (i) => !detail.lines.some((l) => l.itemId === i.itemId),
                      )
                      .map((i) => (
                        <SelectItem
                          key={`${i.itemType}|${i.itemId}`}
                          value={`${i.itemType}|${i.itemId}`}
                        >
                          {i.name}
                          {i.code && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({i.code})
                            </span>
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
                  value={pickedQtyKg}
                  onChange={(e) => setPickedQtyKg(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                disabled={!pickedItemKey || !pickedQtyKg || isAdding}
                onClick={handleAddLine}
              >
                {isAdding ? "Adding…" : "Add"}
              </Button>
            </div>
          )}

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}

          {isDraft && (
            <Button
              disabled={isSubmitting}
              onClick={handleSubmit}
              className="justify-self-start"
            >
              {isSubmitting ? "Submitting…" : "Submit"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
