"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import {
  getApprovalDetail,
  saveLineDecision,
  approveRequisition,
} from "@/app/(app)/requisitions/approve/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
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

type ToApproveSummary = {
  id: string;
  reqNo: string;
  departmentName: string;
  branchName: string;
  neededBy: string;
  lineCount: number;
  decidedCount: number;
  createdAt: string;
};

type ApprovalLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  qtyG: number;
  godownStockG: number;
  onOrderG: number;
  decision: string | null;
  approvedQtyG: number | null;
  decisionNote: string | null;
};

type ApprovalDetail = {
  id: string;
  reqNo: string;
  status: string;
  neededBy: string;
  departmentName: string;
  lines: ApprovalLine[];
};

const DECISION_OPTIONS: Record<
  "raw" | "flavour",
  { value: string; label: string }[]
> = {
  raw: [
    { value: "transfer", label: "Transfer from godown" },
    { value: "buy", label: "Buy" },
    { value: "rejected", label: "Reject" },
  ],
  flavour: [
    { value: "transfer", label: "Transfer from godown" },
    { value: "mix_then_transfer", label: "Mix, then transfer" },
    { value: "rejected", label: "Reject" },
  ],
};

export function RequisitionsApproveView({
  requisitions,
}: {
  requisitions: ToApproveSummary[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  if (requisitions.length === 0 && !selectedId) {
    return (
      <div className="grid gap-6 p-6">
        <PageHeader title="Requisitions to approve" />
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing waiting on you"
          description="Submitted requisitions from your branch will show up here for review."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[360px_1fr]">
      <div className="grid gap-4">
        <PageHeader title="Requisitions to approve" />
        <div className="grid gap-2">
          {requisitions.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={cn(
                "hover:bg-muted flex flex-col gap-1 rounded-lg border p-3 text-left text-sm",
                selectedId === r.id && "border-primary",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.reqNo}</span>
                <span className="text-muted-foreground text-xs">
                  {r.decidedCount}/{r.lineCount} decided
                </span>
              </div>
              <div className="text-muted-foreground text-xs">
                {r.departmentName}
                {r.branchName ? ` · ${r.branchName}` : ""}
              </div>
              <div className="text-muted-foreground text-xs">
                Needed {new Date(r.neededBy).toLocaleDateString("en-IN")}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        {selectedId ? (
          <ApprovalDetailPanel
            requisitionId={selectedId}
            onChange={() => router.refresh()}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center rounded-lg border border-dashed p-16 text-center text-sm">
            Select a requisition from the list to review its lines.
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalDetailPanel({
  requisitionId,
  onChange,
}: {
  requisitionId: string;
  onChange: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<ApprovalDetail | null>(null);
  const [decisions, setDecisions] = React.useState<Record<string, string>>({});
  const [approvedQtyKg, setApprovedQtyKg] = React.useState<
    Record<string, string>
  >({});
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [savedLineIds, setSavedLineIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isApproving, setIsApproving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setServerError(null);
    const result = await getApprovalDetail(requisitionId);
    setLoading(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setDetail(result.data);
    setDecisions(
      Object.fromEntries(
        result.data.lines.map((l) => [l.id, l.decision ?? ""]),
      ),
    );
    setApprovedQtyKg(
      Object.fromEntries(
        result.data.lines.map((l) => [
          l.id,
          String((l.approvedQtyG ?? l.qtyG) / 1000),
        ]),
      ),
    );
    setNotes(
      Object.fromEntries(
        result.data.lines.map((l) => [l.id, l.decisionNote ?? ""]),
      ),
    );
  }, [requisitionId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function saveDecision(
    lineId: string,
    overrides?: { decision?: string },
  ) {
    const decision = overrides?.decision ?? decisions[lineId];
    if (!decision) return;
    const qtyKg = approvedQtyKg[lineId] ?? "";
    const approvedQtyG = qtyKg.trim() === "" ? 0 : kgToGrams(parseFloat(qtyKg));
    const result = await saveLineDecision({
      lineId,
      decision: decision as
        "transfer" | "mix_then_transfer" | "buy" | "rejected",
      approvedQtyG,
      decisionNote: notes[lineId]?.trim() || null,
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

  async function handleApprove() {
    if (!detail) return;
    setServerError(null);
    setIsApproving(true);
    const result = await approveRequisition(detail.id);
    setIsApproving(false);
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
        {serverError ?? "Requisition not found."}
      </p>
    );
  }

  const allDecided = detail.lines.every((l) => decisions[l.id]);

  return (
    <div className="grid gap-4">
      <PageHeader
        title={detail.reqNo}
        description={`${detail.departmentName} · needed by ${new Date(
          detail.neededBy,
        ).toLocaleDateString("en-IN")}`}
        action={<StatusTag status={detail.status} />}
      />

      <div className="grid gap-4">
        {detail.lines.map((line) => {
          const decision = decisions[line.id] ?? "";
          const approvedKg = approvedQtyKg[line.id] ?? "";
          const approvedG =
            approvedKg.trim() === "" ? 0 : kgToGrams(parseFloat(approvedKg));
          const isPartial = approvedG !== line.qtyG;
          const needsNote = decision === "rejected" || isPartial;
          const options = DECISION_OPTIONS[line.itemType];

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
                    requested {formatGrams(line.qtyG)}
                  </span>
                </div>

                <div className="text-muted-foreground grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <span>
                    In stock at godown:{" "}
                    <span className="font-qty text-foreground">
                      {formatGrams(line.godownStockG)}
                    </span>
                  </span>
                  {line.itemType === "raw" && (
                    <span>
                      On order:{" "}
                      <span className="font-qty text-foreground">
                        {formatGrams(line.onOrderG)}
                      </span>
                    </span>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label>Decision</Label>
                    <Select
                      items={options}
                      value={decision}
                      onValueChange={(v) => {
                        if (!v) return;
                        setDecisions((prev) => ({ ...prev, [line.id]: v }));
                        saveDecision(line.id, { decision: v });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Approved qty (kg)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      className="font-qty"
                      value={approvedKg}
                      onChange={(e) =>
                        setApprovedQtyKg((prev) => ({
                          ...prev,
                          [line.id]: e.target.value,
                        }))
                      }
                      onBlur={() => saveDecision(line.id)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>
                      Note{needsNote ? " (required)" : " (optional)"}
                    </Label>
                    <Input
                      placeholder={needsNote ? "Required" : "Optional"}
                      className={cn(
                        needsNote &&
                          !notes[line.id]?.trim() &&
                          "border-destructive",
                      )}
                      value={notes[line.id] ?? ""}
                      onChange={(e) =>
                        setNotes((prev) => ({
                          ...prev,
                          [line.id]: e.target.value,
                        }))
                      }
                      onBlur={() => saveDecision(line.id)}
                    />
                  </div>
                </div>

                {savedLineIds.has(line.id) && (
                  <span className="text-primary text-xs">Saved</span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {serverError && <p className="text-destructive text-sm">{serverError}</p>}

      {detail.status === "submitted" && (
        <div className="flex flex-col items-start gap-2">
          <Button disabled={!allDecided || isApproving} onClick={handleApprove}>
            {isApproving ? "Approving…" : "Approve"}
          </Button>
          {!allDecided && (
            <p className="text-muted-foreground text-xs">
              Every line needs a decision before this requisition can be
              approved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
