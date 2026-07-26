"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import {
  getOrCreateGrnForTransfer,
  getOrCreateGrnForOrder,
  getGrnDetail,
  updateGrnLine,
  updateGrnLineRate,
  uploadGrnInvoice,
  getGrnInvoiceUrl,
  postGrn,
} from "@/app/(app)/send-receive/receive/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatGrams, kgToGrams } from "@/lib/units";
import { cn } from "@/lib/utils";

type InboundTransfer = {
  id: string;
  transferNo: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  requisitionReqNo: string | null;
  dispatchedAt: string;
  lineCount: number;
  existingGrnId: string | null;
  existingGrnStatus: string | null;
};

type InboundOrder = {
  id: string;
  poNo: string;
  supplierName: string;
  shipToDepartmentName: string;
  lineCount: number;
  existingGrnId: string | null;
  existingGrnStatus: string | null;
};

export function ReceiveView({
  transfers,
  orders,
}: {
  transfers: InboundTransfer[];
  orders: InboundOrder[];
}) {
  const router = useRouter();
  const [selectedGrnId, setSelectedGrnId] = React.useState<string | null>(null);
  const [openingId, setOpeningId] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  if (transfers.length === 0 && orders.length === 0) {
    return (
      <div className="grid gap-6 p-6">
        <PageHeader
          title="Receive"
          description="Everything inbound to your departments."
        />
        <EmptyState
          icon={PackageCheck}
          title="Nothing inbound right now"
          description="Dispatched transfers and sent purchase orders waiting for you to receive will show up here."
        />
      </div>
    );
  }

  async function openTransfer(
    transferId: string,
    existingGrnId: string | null,
  ) {
    if (existingGrnId) {
      setSelectedGrnId(existingGrnId);
      return;
    }
    setServerError(null);
    setOpeningId(transferId);
    const result = await getOrCreateGrnForTransfer(transferId);
    setOpeningId(null);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    router.refresh();
    setSelectedGrnId(result.data.grnId);
  }

  async function openOrder(poId: string, existingGrnId: string | null) {
    if (existingGrnId) {
      setSelectedGrnId(existingGrnId);
      return;
    }
    setServerError(null);
    setOpeningId(poId);
    const result = await getOrCreateGrnForOrder(poId);
    setOpeningId(null);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    router.refresh();
    setSelectedGrnId(result.data.grnId);
  }

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[360px_1fr]">
      <div className="grid gap-4">
        <PageHeader title="Receive" />

        {transfers.length > 0 && (
          <div className="grid gap-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Transfers
            </p>
            {transfers.map((t) => (
              <button
                key={t.id}
                onClick={() => openTransfer(t.id, t.existingGrnId)}
                disabled={openingId === t.id}
                className={cn(
                  "hover:bg-muted flex flex-col gap-1 rounded-lg border p-3 text-left text-sm",
                  selectedGrnId === t.existingGrnId &&
                    t.existingGrnId &&
                    "border-primary",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.transferNo}</span>
                  {t.existingGrnStatus && (
                    <StatusTag status={t.existingGrnStatus} />
                  )}
                </div>
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
            ))}
          </div>
        )}

        {orders.length > 0 && (
          <div className="grid gap-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Purchase orders
            </p>
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => openOrder(o.id, o.existingGrnId)}
                disabled={openingId === o.id}
                className={cn(
                  "hover:bg-muted flex flex-col gap-1 rounded-lg border p-3 text-left text-sm",
                  selectedGrnId === o.existingGrnId &&
                    o.existingGrnId &&
                    "border-primary",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{o.poNo}</span>
                  {o.existingGrnStatus && (
                    <StatusTag status={o.existingGrnStatus} />
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {o.supplierName} → {o.shipToDepartmentName}
                </span>
                <span className="text-muted-foreground text-xs">
                  {o.lineCount} item{o.lineCount === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        )}

        {serverError && (
          <p className="text-destructive text-sm">{serverError}</p>
        )}
      </div>

      <div>
        {selectedGrnId ? (
          <GrnFormPanel
            grnId={selectedGrnId}
            onChange={() => router.refresh()}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center rounded-lg border border-dashed p-16 text-center text-sm">
            Select an inbound transfer or purchase order to start its GRN.
          </div>
        )}
      </div>
    </div>
  );
}

type GrnLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  expectedQtyG: number;
  receivedQtyG: number | null;
  damagedQtyG: number | null;
  reason: string | null;
  overReceived: boolean;
  rate: number | null;
};

type GrnDetail = {
  id: string;
  grnNo: string;
  status: string;
  source: "internal" | "vendor";
  departmentName: string;
  transferNo: string | null;
  fromDepartmentName: string | null;
  requisitionReqNo: string | null;
  poNo: string | null;
  supplierName: string | null;
  invoicePath: string | null;
  lines: GrnLine[];
};

function GrnFormPanel({
  grnId,
  onChange,
}: {
  grnId: string;
  onChange: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<GrnDetail | null>(null);
  const [receivedKg, setReceivedKg] = React.useState<Record<string, string>>(
    {},
  );
  const [damagedKg, setDamagedKg] = React.useState<Record<string, string>>({});
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const [overFlags, setOverFlags] = React.useState<Record<string, boolean>>({});
  const [rates, setRates] = React.useState<Record<string, string>>({});
  const [savedLineIds, setSavedLineIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isPosting, setIsPosting] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [invoiceUrl, setInvoiceUrl] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setServerError(null);
    const result = await getGrnDetail(grnId);
    setLoading(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setDetail(result.data);
    setReceivedKg(
      Object.fromEntries(
        result.data.lines.map((l) => [
          l.id,
          l.receivedQtyG != null ? String(l.receivedQtyG / 1000) : "",
        ]),
      ),
    );
    setDamagedKg(
      Object.fromEntries(
        result.data.lines.map((l) => [
          l.id,
          l.damagedQtyG != null ? String(l.damagedQtyG / 1000) : "",
        ]),
      ),
    );
    setReasons(
      Object.fromEntries(result.data.lines.map((l) => [l.id, l.reason ?? ""])),
    );
    setOverFlags(
      Object.fromEntries(result.data.lines.map((l) => [l.id, l.overReceived])),
    );
    setRates(
      Object.fromEntries(
        result.data.lines.map((l) => [l.id, l.rate != null ? String(l.rate) : ""]),
      ),
    );
    if (result.data.invoicePath) {
      const urlResult = await getGrnInvoiceUrl(grnId);
      setInvoiceUrl(urlResult.success ? urlResult.data : null);
    } else {
      setInvoiceUrl(null);
    }
  }, [grnId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function saveRate(lineId: string) {
    const value = rates[lineId] ?? "";
    const rate = value.trim() === "" ? null : parseFloat(value);
    const result = await updateGrnLineRate(lineId, rate);
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
    } else {
      setServerError(result.error);
    }
  }

  async function handleInvoiceChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    setIsUploading(true);
    setServerError(null);
    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadGrnInvoice(detail.id, formData);
    setIsUploading(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    const urlResult = await getGrnInvoiceUrl(detail.id);
    setInvoiceUrl(urlResult.success ? urlResult.data : null);
  }

  async function saveLine(lineId: string, overrides?: { over?: boolean }) {
    const line = detail?.lines.find((l) => l.id === lineId);
    if (!line) return;
    const receivedG =
      (receivedKg[lineId] ?? "").trim() === ""
        ? 0
        : kgToGrams(parseFloat(receivedKg[lineId]));
    const damagedG =
      (damagedKg[lineId] ?? "").trim() === ""
        ? 0
        : kgToGrams(parseFloat(damagedKg[lineId]));
    const over = overrides?.over ?? overFlags[lineId] ?? false;
    const result = await updateGrnLine({
      lineId,
      receivedQtyG: receivedG,
      damagedQtyG: damagedG,
      reason: reasons[lineId]?.trim() || null,
      overReceived: over,
    });
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
    } else {
      setServerError(result.error);
    }
  }

  async function handlePost() {
    if (!detail) return;
    setServerError(null);
    setIsPosting(true);
    const result = await postGrn(detail.id);
    setIsPosting(false);
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
        {serverError ?? "GRN not found."}
      </p>
    );
  }

  const isDraft = detail.status === "draft";
  const isVendor = detail.source === "vendor";
  const allLinesReceived = detail.lines.every(
    (l) => (receivedKg[l.id] ?? "").trim() !== "",
  );
  const description = isVendor
    ? `${detail.supplierName ?? "?"} → ${detail.departmentName}${detail.poNo ? ` · ${detail.poNo}` : ""}`
    : `${detail.fromDepartmentName ?? "?"} → ${detail.departmentName}${
        detail.transferNo ? ` · ${detail.transferNo}` : ""
      }${detail.requisitionReqNo ? ` · from ${detail.requisitionReqNo}` : ""}`;

  return (
    <div className="grid gap-4">
      <PageHeader
        title={detail.grnNo}
        description={description}
        action={<StatusTag status={detail.status} />}
      />

      {isVendor && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Label className="text-sm font-medium">Invoice</Label>
            {invoiceUrl && (
              <a
                href={invoiceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary text-sm underline"
              >
                View current invoice
              </a>
            )}
            {isDraft && (
              <label className="text-muted-foreground text-sm">
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={handleInvoiceChange}
                  disabled={isUploading}
                />
                <span className="border-input hover:bg-muted cursor-pointer rounded-md border px-3 py-1.5">
                  {isUploading
                    ? "Uploading…"
                    : invoiceUrl
                      ? "Replace file"
                      : "Upload invoice"}
                </span>
              </label>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {detail.lines.map((line) => {
          const receivedVal = receivedKg[line.id] ?? "";
          const damagedVal = damagedKg[line.id] ?? "";
          const receivedG =
            receivedVal.trim() === "" ? 0 : kgToGrams(parseFloat(receivedVal));
          const damagedG =
            damagedVal.trim() === "" ? 0 : kgToGrams(parseFloat(damagedVal));
          const totalG = receivedG + damagedG;
          const isShort = totalG < line.expectedQtyG;
          const isOver = totalG > line.expectedQtyG;
          const needsNote = isShort || (isOver && !overFlags[line.id]);
          const needsOverFlag = isOver;

          return (
            <Card key={line.id}>
              <CardContent className="grid gap-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">
                    {line.name}
                    {line.code && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {line.code}
                      </span>
                    )}
                  </span>
                  <span className="font-qty text-sm">
                    expected {formatGrams(line.expectedQtyG)}
                  </span>
                </div>

                <div
                  className={cn(
                    "grid gap-3",
                    isVendor ? "sm:grid-cols-4" : "sm:grid-cols-3",
                  )}
                >
                  <div className="grid gap-1.5">
                    <Label>Received (kg)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      disabled={!isDraft}
                      className="font-qty"
                      value={receivedVal}
                      onChange={(e) =>
                        setReceivedKg((prev) => ({
                          ...prev,
                          [line.id]: e.target.value,
                        }))
                      }
                      onBlur={() => saveLine(line.id)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Damaged (kg, optional)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      disabled={!isDraft}
                      className="font-qty"
                      value={damagedVal}
                      onChange={(e) =>
                        setDamagedKg((prev) => ({
                          ...prev,
                          [line.id]: e.target.value,
                        }))
                      }
                      onBlur={() => saveLine(line.id)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>
                      Reason{needsNote ? " (required)" : " (optional)"}
                    </Label>
                    <Input
                      disabled={!isDraft}
                      placeholder={needsNote ? "Required" : "Optional"}
                      className={cn(
                        needsNote &&
                          !reasons[line.id]?.trim() &&
                          "border-destructive",
                      )}
                      value={reasons[line.id] ?? ""}
                      onChange={(e) =>
                        setReasons((prev) => ({
                          ...prev,
                          [line.id]: e.target.value,
                        }))
                      }
                      onBlur={() => saveLine(line.id)}
                    />
                  </div>
                  {isVendor && (
                    <div className="grid gap-1.5">
                      <Label>Rate</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="Blank"
                        disabled={!isDraft}
                        value={rates[line.id] ?? ""}
                        onChange={(e) =>
                          setRates((prev) => ({
                            ...prev,
                            [line.id]: e.target.value,
                          }))
                        }
                        onBlur={() => saveRate(line.id)}
                      />
                    </div>
                  )}
                </div>

                {needsOverFlag && isDraft && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={overFlags[line.id] ?? false}
                      onCheckedChange={(checked) => {
                        const over = checked === true;
                        setOverFlags((prev) => ({ ...prev, [line.id]: over }));
                        saveLine(line.id, { over });
                      }}
                    />
                    This is a confirmed over-receipt (more than expected)
                  </label>
                )}

                {savedLineIds.has(line.id) && (
                  <span className="text-primary text-xs">Saved</span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {serverError && <p className="text-destructive text-sm">{serverError}</p>}

      {isDraft && (
        <div className="flex flex-col items-start gap-2">
          <Button
            disabled={!allLinesReceived || isPosting}
            onClick={handlePost}
          >
            {isPosting ? "Posting…" : "Post"}
          </Button>
          {!allLinesReceived && (
            <p className="text-muted-foreground text-xs">
              Every line needs a received quantity before this GRN can be
              posted.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
