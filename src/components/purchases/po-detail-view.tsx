"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Printer,
  Download,
  IndianRupee,
  ListChecks,
  Package,
  Ban,
  CheckCircle2,
} from "lucide-react";
import {
  updatePoLineRate,
  updatePoLineQty,
  sendOrder,
  setExpectedDeliveryDate,
  cancelOrder,
  closeOrder,
} from "@/app/(app)/purchases/orders/[poId]/actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusTag } from "@/components/shared/status-tag";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatGrams, kgToGrams } from "@/lib/units";

type PoLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  itemName: string;
  itemCode: string | null;
  qtyG: number;
  rate: number | null;
};

type LinkedGrn = {
  id: string;
  grnNo: string;
  status: string;
  postedAt: string | null;
  receivedG: number;
  damagedG: number;
  transportationCost: number | null;
};

type PoDetail = {
  id: string;
  poNo: string;
  status: string;
  branchName: string;
  createdAt: string;
  sentAt: string | null;
  expectedDeliveryDate: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  closedAt: string | null;
  notes: string | null;
  supplier: {
    name: string;
    area: string | null;
    contactPerson: string | null;
    phone: string | null;
    gstin: string | null;
  };
  shipTo: { departmentName: string; branchName: string };
  lines: PoLine[];
  receiving: { orderedG: number; receivedG: number; pendingG: number };
  linkedGrns: LinkedGrn[];
};

export function PoDetailView({
  initialDetail,
  canEdit,
}: {
  initialDetail: PoDetail;
  canEdit: boolean;
}) {
  const [detail, setDetail] = React.useState(initialDetail);
  const [qtyValues, setQtyValues] = React.useState<Record<string, string>>(
    Object.fromEntries(
      initialDetail.lines.map((l) => [l.id, String(l.qtyG / 1000)]),
    ),
  );
  const [rateValues, setRateValues] = React.useState<Record<string, string>>(
    Object.fromEntries(
      initialDetail.lines.map((l) => [l.id, l.rate != null ? String(l.rate) : ""]),
    ),
  );
  const [savedLineIds, setSavedLineIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [isSending, setIsSending] = React.useState(false);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [expectedDate, setExpectedDate] = React.useState(
    initialDetail.expectedDeliveryDate ?? "",
  );
  const [expectedSaved, setExpectedSaved] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState("");
  const [showCancel, setShowCancel] = React.useState(false);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [isClosing, setIsClosing] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const isDraft = detail.status === "draft";

  const totalQtyG = detail.lines.reduce((s, l) => s + l.qtyG, 0);
  const totalValue = detail.lines.reduce(
    (s, l) => s + (l.rate != null ? (l.qtyG / 1000) * l.rate : 0),
    0,
  );
  const roundedValue = Math.round(totalValue * 100) / 100;
  const pricedLineCount = detail.lines.filter((l) => l.rate != null).length;

  function flashSaved(lineId: string) {
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

  async function handleQtyBlur(lineId: string) {
    if (!isDraft) return;
    const value = qtyValues[lineId] ?? "";
    const qtyG = value.trim() === "" ? 0 : kgToGrams(parseFloat(value));
    if (qtyG <= 0) return;
    const result = await updatePoLineQty(lineId, qtyG);
    if (result.success) {
      setDetail((prev) => ({
        ...prev,
        lines: prev.lines.map((l) => (l.id === lineId ? { ...l, qtyG } : l)),
      }));
      flashSaved(lineId);
    } else {
      setServerError(result.error);
    }
  }

  async function handleRateBlur(lineId: string) {
    const value = rateValues[lineId] ?? "";
    const rate = value.trim() === "" ? null : parseFloat(value);
    const result = await updatePoLineRate(lineId, rate);
    if (result.success) {
      setDetail((prev) => ({
        ...prev,
        lines: prev.lines.map((l) => (l.id === lineId ? { ...l, rate } : l)),
      }));
      flashSaved(lineId);
    } else {
      setServerError(result.error);
    }
  }

  async function handleSend() {
    setServerError(null);
    setIsSending(true);
    const result = await sendOrder(detail.id);
    setIsSending(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setDetail((prev) => ({
      ...prev,
      status: "sent",
      sentAt: new Date().toISOString(),
    }));
  }

  const lineColumns: DataTableColumn<PoLine>[] = [
    {
      key: "item",
      header: "Material",
      cardRole: "title",
      className: "whitespace-nowrap",
      render: (line) => (
        <>
          {line.itemName}
          {line.itemCode && (
            <span className="text-muted-foreground"> · {line.itemCode}</span>
          )}
        </>
      ),
    },
    {
      key: "qty",
      header: "Quantity (kg)",
      numeric: true,
      render: (line) =>
        isDraft && canEdit ? (
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            aria-label={`Quantity for ${line.itemName}`}
            className="font-qty ml-auto w-24 text-right"
            value={qtyValues[line.id] ?? ""}
            onChange={(e) =>
              setQtyValues((prev) => ({ ...prev, [line.id]: e.target.value }))
            }
            onBlur={() => handleQtyBlur(line.id)}
          />
        ) : (
          <span className="font-qty whitespace-nowrap">
            {formatGrams(line.qtyG)}
          </span>
        ),
    },
    {
      key: "rate",
      header: "Rate",
      numeric: true,
      render: (line) => (
        <>
          {canEdit ? (
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="Blank"
              aria-label={`Rate for ${line.itemName}`}
              className="ml-auto w-24 text-right"
              value={rateValues[line.id] ?? ""}
              onChange={(e) =>
                setRateValues((prev) => ({ ...prev, [line.id]: e.target.value }))
              }
              onBlur={() => handleRateBlur(line.id)}
            />
          ) : (
            <span className="whitespace-nowrap">
              {line.rate != null ? `₹${line.rate}` : "—"}
            </span>
          )}
          {savedLineIds.has(line.id) && (
            <span className="text-primary block text-xs">Saved</span>
          )}
        </>
      ),
    },
  ];

  const linkedGrnColumns: DataTableColumn<LinkedGrn>[] = [
    {
      key: "grnNo",
      header: "GRN",
      cardRole: "title",
      render: (g) => <span className="font-medium">{g.grnNo}</span>,
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (g) => <StatusTag status={g.status} />,
    },
    {
      key: "date",
      header: "Date",
      className: "text-muted-foreground whitespace-nowrap",
      render: (g) =>
        g.postedAt ? new Date(g.postedAt).toLocaleDateString("en-IN") : "—",
    },
    {
      key: "received",
      header: "Received",
      numeric: true,
      className: "whitespace-nowrap",
      render: (g) => formatGrams(g.receivedG),
    },
    {
      key: "transport",
      header: "Transport",
      numeric: true,
      className: "whitespace-nowrap",
      render: (g) =>
        g.transportationCost != null ? `₹${g.transportationCost}` : "—",
    },
  ];

  async function handleExpectedDateBlur() {
    const value = expectedDate.trim() === "" ? null : expectedDate;
    const result = await setExpectedDeliveryDate(detail.id, value);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setDetail((prev) => ({ ...prev, expectedDeliveryDate: value }));
    setExpectedSaved(true);
    setTimeout(() => setExpectedSaved(false), 1500);
  }

  async function handleCancel() {
    setServerError(null);
    setIsCancelling(true);
    const result = await cancelOrder(detail.id, cancelReason);
    setIsCancelling(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setDetail((prev) => ({
      ...prev,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelledReason: cancelReason,
    }));
    setShowCancel(false);
  }

  async function handleClose() {
    setServerError(null);
    setIsClosing(true);
    const result = await closeOrder(detail.id);
    setIsClosing(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setDetail((prev) => ({
      ...prev,
      status: "closed",
      closedAt: new Date().toISOString(),
    }));
  }

  async function handleDownloadPdf() {
    setServerError(null);
    setIsDownloading(true);
    try {
      const { downloadPoPdf } = await import("@/lib/purchases/po-pdf");
      await downloadPoPdf({
        poNo: detail.poNo,
        createdAt: detail.createdAt,
        sentAt: detail.sentAt,
        expectedDeliveryDate: detail.expectedDeliveryDate,
        branchName: detail.branchName,
        shipTo: detail.shipTo,
        // Only ever what this session was actually served — a role that
        // isn't sent supplier data can't leak it into a PDF.
        supplier: detail.supplier,
        lines: detail.lines.map((l) => ({
          itemName: l.itemName,
          itemCode: l.itemCode,
          qtyG: l.qtyG,
          rate: l.rate,
        })),
        notes: detail.notes,
      });
    } catch {
      setServerError("Could not generate the PDF. Try the printable order instead.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={detail.poNo}
        description={`${detail.supplier.name} · Ship to ${detail.shipTo.departmentName} (${detail.shipTo.branchName})`}
        action={
          <div className="flex gap-2">
            <Link
              href="/purchases/orders"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ArrowLeft /> Back to orders
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
            >
              <Download /> {isDownloading ? "Preparing…" : "Download PDF"}
            </Button>
            <Link
              href={`/purchases/orders/${detail.id}/print`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Printer /> Print
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Order value"
          value={`₹${roundedValue}`}
          detail={`${pricedLineCount}/${detail.lines.length} lines rated`}
          icon={IndianRupee}
          tone="primary"
          className="col-span-2 sm:col-span-1"
        />
        <StatCard label="Lines" value={String(detail.lines.length)} icon={ListChecks} />
        <StatCard
          label="Total quantity"
          value={formatGrams(totalQtyG)}
          icon={Package}
        />
      </div>

      <div className="flex items-center gap-2">
        <StatusTag status={detail.status} />
        <span className="text-muted-foreground text-sm">
          Created {new Date(detail.createdAt).toLocaleDateString("en-IN")}
          {detail.sentAt &&
            ` · Sent ${new Date(detail.sentAt).toLocaleDateString("en-IN")}`}
        </span>
      </div>

      <Card>
        <CardContent className="grid gap-4">
          <DataTable
            columns={lineColumns}
            data={detail.lines}
            getRowKey={(line) => line.id}
          />

          {!isDraft && (
            <p className="text-muted-foreground text-sm">
              Quantity is locked once an order has been sent — rate stays
              editable.
            </p>
          )}

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-end gap-3 border-t pt-4">
              <div className="grid gap-1.5">
                <Label htmlFor="expected-date">Expected delivery date</Label>
                <Input
                  id="expected-date"
                  type="date"
                  className="w-44"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  onBlur={handleExpectedDateBlur}
                />
              </div>
              {expectedSaved && (
                <span className="text-primary pb-2 text-xs">Saved</span>
              )}
              <p className="text-muted-foreground pb-2 text-xs">
                Lead time runs from the order date, not this — this is what
                the supplier promised, and what &ldquo;overdue&rdquo; is
                measured against.
              </p>
            </div>
          )}

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}

          {detail.status === "cancelled" && detail.cancelledReason && (
            <p className="text-destructive text-sm">
              Cancelled: {detail.cancelledReason}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {isDraft && canEdit && (
              <Button disabled={isSending} onClick={handleSend}>
                {isSending ? "Sending…" : "Send order"}
              </Button>
            )}
            {canEdit &&
              (detail.status === "draft" || detail.status === "sent") && (
                <Button
                  variant="outline"
                  onClick={() => setShowCancel((v) => !v)}
                >
                  <Ban /> Cancel order
                </Button>
              )}
            {canEdit && detail.status === "received" && (
              <Button variant="outline" disabled={isClosing} onClick={handleClose}>
                <CheckCircle2 /> {isClosing ? "Closing…" : "Close order"}
              </Button>
            )}
          </div>

          {showCancel && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor="cancel-reason">Reason for cancelling</Label>
                <Input
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Supplier can't fulfil this month"
                />
              </div>
              <Button
                variant="destructive"
                disabled={!cancelReason.trim() || isCancelling}
                onClick={handleCancel}
              >
                {isCancelling ? "Cancelling…" : "Confirm cancel"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="grid gap-3">
            <p className="text-sm font-medium">Receiving progress</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Ordered", value: detail.receiving.orderedG },
                { label: "Received", value: detail.receiving.receivedG },
                { label: "Pending", value: detail.receiving.pendingG },
              ].map((cell) => (
                <div key={cell.label} className="bg-muted/40 rounded-md p-3">
                  <p className="font-qty text-lg leading-none">
                    {formatGrams(cell.value)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {cell.label}
                  </p>
                </div>
              ))}
            </div>
            {detail.receiving.orderedG > 0 && (
              <div className="bg-muted h-2 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        (detail.receiving.receivedG /
                          detail.receiving.orderedG) *
                          100,
                      ),
                    )}%`,
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-3">
            <p className="text-sm font-medium">Linked GRNs</p>
            <DataTable
              columns={linkedGrnColumns}
              data={detail.linkedGrns}
              getRowKey={(g) => g.id}
              embedded
              emptyState={
                <p className="text-muted-foreground text-sm">
                  Nothing received against this order yet.
                </p>
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
