"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Printer, IndianRupee, ListChecks, Package } from "lucide-react";
import {
  updatePoLineRate,
  updatePoLineQty,
  sendOrder,
} from "@/app/(app)/purchases/orders/[poId]/actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusTag } from "@/components/shared/status-tag";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatGrams, kgToGrams } from "@/lib/units";

type PoLine = {
  id: string;
  rawMaterialId: string;
  rawMaterialName: string;
  rawMaterialCode: string | null;
  qtyG: number;
  rate: number | null;
};

type PoDetail = {
  id: string;
  poNo: string;
  status: string;
  branchName: string;
  createdAt: string;
  sentAt: string | null;
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
            <Link
              href={`/purchases/orders/${detail.id}/print`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Printer /> Printable order
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
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                    Material
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Quantity (kg)
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {line.rawMaterialName}
                      {line.rawMaterialCode && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {line.rawMaterialCode}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isDraft && canEdit ? (
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0"
                          className="font-qty ml-auto w-24 text-right"
                          value={qtyValues[line.id] ?? ""}
                          onChange={(e) =>
                            setQtyValues((prev) => ({
                              ...prev,
                              [line.id]: e.target.value,
                            }))
                          }
                          onBlur={() => handleQtyBlur(line.id)}
                        />
                      ) : (
                        <span className="font-qty whitespace-nowrap">
                          {formatGrams(line.qtyG)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit ? (
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          placeholder="Blank"
                          className="ml-auto w-24 text-right"
                          value={rateValues[line.id] ?? ""}
                          onChange={(e) =>
                            setRateValues((prev) => ({
                              ...prev,
                              [line.id]: e.target.value,
                            }))
                          }
                          onBlur={() => handleRateBlur(line.id)}
                        />
                      ) : (
                        <span className="whitespace-nowrap">
                          {line.rate != null ? `₹${line.rate}` : "—"}
                        </span>
                      )}
                      {savedLineIds.has(line.id) && (
                        <span className="text-primary block text-xs">
                          Saved
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isDraft && (
            <p className="text-muted-foreground text-sm">
              Quantity is locked once an order has been sent — rate stays
              editable.
            </p>
          )}

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}

          {isDraft && canEdit && (
            <Button
              disabled={isSending}
              onClick={handleSend}
              className="justify-self-start"
            >
              {isSending ? "Sending…" : "Send order"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
