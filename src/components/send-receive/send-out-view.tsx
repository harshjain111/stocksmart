"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Truck, Plus, Send, Package } from "lucide-react";
import {
  getAvailableItemsAtDepartment,
  createAdHocTransfer,
  getTransferDetail,
  updateTransferLineQty,
  dispatchTransfer,
} from "@/app/(app)/send-receive/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { formatGrams, kgToGrams } from "@/lib/units";
import { cn } from "@/lib/utils";

type DraftTransferSummary = {
  id: string;
  transferNo: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  requisitionReqNo: string | null;
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

export function SendOutView({
  transfers,
  departments,
}: {
  transfers: DraftTransferSummary[];
  departments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [view, setView] = React.useState<"list" | "compose" | "detail">("list");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  if (departments.length === 0) {
    return (
      <div className="grid gap-6 p-6">
        <PageHeader title="Send out" />
        <EmptyState
          icon={Truck}
          title="No departments yet"
          description="Add departments under Setup > Branches & departments first."
        />
      </div>
    );
  }

  const totalItemsQueued = transfers.reduce((sum, t) => sum + t.lineCount, 0);

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[340px_1fr]">
      <div className="grid gap-4">
        <PageHeader
          title="Send out"
          action={
            <Button size="sm" onClick={() => setView("compose")}>
              <Plus className="size-4" />
              New transfer
            </Button>
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Ready to send"
            value={String(transfers.length)}
            icon={Send}
            tone="primary"
          />
          <StatCard
            label="Items queued"
            value={String(totalItemsQueued)}
            icon={Package}
          />
        </div>
        <div className="grid gap-2">
          {transfers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing to send right now.
            </p>
          ) : (
            transfers.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedId(t.id);
                  setView("detail");
                }}
                className={cn(
                  "hover:bg-muted flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
                  selectedId === t.id && view === "detail" && "border-primary",
                )}
              >
                <span className="font-medium">{t.transferNo}</span>
                <span className="text-muted-foreground text-xs">
                  {t.fromDepartmentName} → {t.toDepartmentName}
                </span>
                <span className="text-muted-foreground flex items-center justify-between text-xs">
                  <span>
                    {t.lineCount} item{t.lineCount === 1 ? "" : "s"}
                  </span>
                  {t.requisitionReqNo && <span>{t.requisitionReqNo}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div>
        {view === "compose" && (
          <ComposeTransfer
            departments={departments}
            onCancel={() => setView(selectedId ? "detail" : "list")}
            onCreated={(id) => {
              router.refresh();
              setSelectedId(id);
              setView("detail");
            }}
          />
        )}
        {view === "detail" && selectedId && (
          <TransferDetailPanel
            transferId={selectedId}
            onChange={() => router.refresh()}
          />
        )}
        {view === "list" && (
          <div className="text-muted-foreground flex h-full items-center justify-center rounded-lg border border-dashed p-16 text-center text-sm">
            Select a transfer from the list, or start a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function ComposeTransfer({
  departments,
  onCancel,
  onCreated,
}: {
  departments: { id: string; name: string }[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [fromDepartmentId, setFromDepartmentId] = React.useState(
    departments[0]?.id ?? "",
  );
  const [toDepartmentId, setToDepartmentId] = React.useState("");
  const [availableItems, setAvailableItems] = React.useState<AvailableItem[]>(
    [],
  );
  const [pickedItemKey, setPickedItemKey] = React.useState("");
  const [pickedQtyKg, setPickedQtyKg] = React.useState("");
  const [lines, setLines] = React.useState<
    (AvailableItem & { qtyKg: string })[]
  >([]);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const loadItems = React.useCallback(async (deptId: string) => {
    const result = await getAvailableItemsAtDepartment(deptId);
    setAvailableItems(result.success ? result.data : []);
  }, []);

  React.useEffect(() => {
    if (fromDepartmentId) loadItems(fromDepartmentId);
    setLines([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDepartmentId]);

  const toOptions = departments.filter((d) => d.id !== fromDepartmentId);
  const pickableItems = availableItems.filter(
    (item) => !lines.some((l) => l.itemId === item.itemId),
  );

  function addLine() {
    const item = availableItems.find(
      (i) => `${i.itemType}|${i.itemId}` === pickedItemKey,
    );
    const qtyG = pickedQtyKg ? kgToGrams(parseFloat(pickedQtyKg)) : 0;
    if (!item || qtyG <= 0) return;
    setLines((prev) => [...prev, { ...item, qtyKg: pickedQtyKg }]);
    setPickedItemKey("");
    setPickedQtyKg("");
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  const canSave = !!fromDepartmentId && !!toDepartmentId && lines.length > 0;

  async function handleSave() {
    if (!canSave) return;
    setServerError(null);
    setIsSubmitting(true);
    const result = await createAdHocTransfer({
      fromDepartmentId,
      toDepartmentId,
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
    onCreated(result.data.transferId);
  }

  return (
    <div className="grid gap-4">
      <PageHeader title="New transfer" />
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>From</Label>
            <Select
              items={departments.map((d) => ({ value: d.id, label: d.name }))}
              value={fromDepartmentId}
              onValueChange={(v) => {
                if (!v) return;
                setFromDepartmentId(v);
                if (v === toDepartmentId) setToDepartmentId("");
              }}
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
            <Label>To</Label>
            <Select
              items={toOptions.map((d) => ({ value: d.id, label: d.name }))}
              value={toDepartmentId}
              onValueChange={(v) => v && setToDepartmentId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a department" />
              </SelectTrigger>
              <SelectContent>
                {toOptions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4">
          {availableItems.length === 0 ? (
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
                      Sending
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
                          size="sm"
                          onClick={() => removeLine(line.itemId)}
                        >
                          Remove
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

type TransferDetail = {
  id: string;
  transferNo: string;
  status: string;
  fromDepartmentId: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  requisitionReqNo: string | null;
  courier: string | null;
  docketNo: string | null;
  lines: {
    id: string;
    itemType: "raw" | "flavour";
    itemId: string;
    name: string;
    code: string | null;
    qtyG: number;
    currentStockG: number;
  }[];
};

function TransferDetailPanel({
  transferId,
  onChange,
}: {
  transferId: string;
  onChange: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<TransferDetail | null>(null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [savedLineIds, setSavedLineIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [courier, setCourier] = React.useState("");
  const [docketNo, setDocketNo] = React.useState("");
  const [isDispatching, setIsDispatching] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setServerError(null);
    const result = await getTransferDetail(transferId);
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
    setCourier(result.data.courier ?? "");
    setDocketNo(result.data.docketNo ?? "");
  }, [transferId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function handleQtyBlur(lineId: string) {
    if (!detail || detail.status !== "draft") return;
    const value = values[lineId] ?? "";
    const qtyG = value.trim() === "" ? 0 : kgToGrams(parseFloat(value));
    if (qtyG <= 0) return;
    const result = await updateTransferLineQty(lineId, qtyG);
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
      onChange();
    }
  }

  async function handleDispatch() {
    if (!detail) return;
    setServerError(null);
    setIsDispatching(true);
    const result = await dispatchTransfer({
      transferId: detail.id,
      courier: courier.trim() || null,
      docketNo: docketNo.trim() || null,
    });
    setIsDispatching(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    onChange();
    load();
  }

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!detail) {
    return (
      <p className="text-destructive text-sm">
        {serverError ?? "Transfer not found."}
      </p>
    );
  }

  const isDraft = detail.status === "draft";
  const anyInsufficient = detail.lines.some((line) => {
    const kg = values[line.id] ?? "";
    const qtyG = kg.trim() === "" ? 0 : kgToGrams(parseFloat(kg));
    return qtyG > line.currentStockG;
  });

  return (
    <div className="grid gap-4">
      <PageHeader
        title={detail.transferNo}
        description={`${detail.fromDepartmentName} → ${detail.toDepartmentName}${
          detail.requisitionReqNo ? ` · from ${detail.requisitionReqNo}` : ""
        }`}
        action={
          !isDraft && (
            <a
              href={`/send-receive/dispatch-note/${detail.id}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Print dispatch note
            </a>
          )
        }
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
                    Current stock
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Sending (kg)
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => {
                  const kg = values[line.id] ?? "";
                  const qtyG = kg.trim() === "" ? 0 : kgToGrams(parseFloat(kg));
                  const insufficient = qtyG > line.currentStockG;
                  return (
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
                      <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                        {formatGrams(line.currentStockG)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isDraft ? (
                          <>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.1"
                              min="0"
                              className={cn(
                                "font-qty ml-auto w-28 text-right",
                                insufficient && "border-destructive",
                              )}
                              value={kg}
                              onChange={(e) =>
                                setValues((prev) => ({
                                  ...prev,
                                  [line.id]: e.target.value,
                                }))
                              }
                              onBlur={() => handleQtyBlur(line.id)}
                            />
                            {insufficient && (
                              <span className="text-destructive block text-xs">
                                More than in stock
                              </span>
                            )}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {isDraft && (
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="courier">Courier / vehicle (optional)</Label>
                <Input
                  id="courier"
                  value={courier}
                  onChange={(e) => setCourier(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="docket">Docket number (optional)</Label>
                <Input
                  id="docket"
                  value={docketNo}
                  onChange={(e) => setDocketNo(e.target.value)}
                />
              </div>
            </div>
          )}

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}

          {isDraft && (
            <Button
              disabled={isDispatching || anyInsufficient}
              onClick={handleDispatch}
              className="justify-self-start"
            >
              {isDispatching ? "Dispatching…" : "Dispatch"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
