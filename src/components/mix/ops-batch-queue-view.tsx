"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  listDraftBatchesForOps,
  getOpsBatchCard,
  confirmBatch,
} from "@/app/(app)/mix/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatGrams } from "@/lib/units";

type BatchSummary = {
  id: string;
  batchNo: string;
  flavourName: string;
  outputG: number;
  createdAt: string;
};

type OpsLine = {
  rawMaterialId: string;
  code: string | null;
  name: string;
  percentage: number;
  plannedG: number;
};

export function OpsBatchQueueView() {
  const router = useRouter();
  const [batches, setBatches] = React.useState<BatchSummary[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [card, setCard] = React.useState<{
    batchNo: string;
    flavourName: string;
    outputG: number;
    lines: OpsLine[];
  } | null>(null);
  const [loadingCard, setLoadingCard] = React.useState(false);
  const [ticked, setTicked] = React.useState<Record<string, boolean>>({});
  const [actualG, setActualG] = React.useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listDraftBatchesForOps().then((result) => {
      setLoadingList(false);
      if (result.success) setBatches(result.data);
    });
  }, []);

  async function selectBatch(id: string) {
    setSelectedId(id);
    setCard(null);
    setTicked({});
    setActualG({});
    setServerError(null);
    setLoadingCard(true);
    const result = await getOpsBatchCard(id);
    setLoadingCard(false);
    if (result.success) {
      setCard(result.data);
      setActualG(
        Object.fromEntries(
          result.data.lines.map((l) => [l.rawMaterialId, String(l.plannedG)]),
        ),
      );
    }
  }

  const allTicked =
    !!card &&
    card.lines.length > 0 &&
    card.lines.every((l) => ticked[l.rawMaterialId]);
  const canConfirm = allTicked && !isSubmitting;

  async function handleConfirm() {
    if (!canConfirm || !card || !selectedId) return;
    setServerError(null);
    setIsSubmitting(true);
    const result = await confirmBatch(
      selectedId,
      card.lines.map((l) => ({
        rawMaterialId: l.rawMaterialId,
        actualG: Math.round(parseFloat(actualG[l.rawMaterialId]) || 0),
      })),
    );
    setIsSubmitting(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setSelectedId(null);
    setCard(null);
    setTicked({});
    setActualG({});
    const refreshed = await listDraftBatchesForOps();
    if (refreshed.success) setBatches(refreshed.data);
    router.refresh();
  }

  if (loadingList) return <Skeleton className="h-24 w-full" />;
  if (batches.length === 0) return null;

  return (
    <div className="grid gap-2">
      <h2 className="text-lg font-semibold tracking-tight">
        Drafts waiting to be confirmed
      </h2>
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardContent className="grid gap-1 p-2">
            {batches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBatch(b.id)}
                className={cn(
                  "flex flex-col rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  b.id === selectedId
                    ? "bg-primary/15 text-primary"
                    : "hover:bg-muted text-foreground",
                )}
              >
                <span className="font-medium">{b.flavourName}</span>
                <span className="text-muted-foreground text-xs">
                  {b.batchNo} · {formatGrams(b.outputG)}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            {!selectedId ? (
              <p className="text-muted-foreground text-sm">
                Select a batch to confirm it.
              </p>
            ) : loadingCard ? (
              <div className="grid gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : card ? (
              <>
                <div>
                  <p className="text-sm font-medium">{card.flavourName}</p>
                  <p className="text-muted-foreground text-xs">
                    {card.batchNo} · target {formatGrams(card.outputG)}
                  </p>
                </div>

                <div className="grid gap-2">
                  {card.lines.map((line) => (
                    <div
                      key={line.rawMaterialId}
                      className="hover:bg-muted flex items-center gap-3 rounded-lg border p-3"
                    >
                      <Checkbox
                        checked={ticked[line.rawMaterialId] ?? false}
                        onCheckedChange={(checked) =>
                          setTicked((prev) => ({
                            ...prev,
                            [line.rawMaterialId]: checked === true,
                          }))
                        }
                      />
                      <span className="flex-1 text-sm font-medium">
                        {line.name}
                        {line.code && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {line.code}
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        planned {formatGrams(line.plannedG)}
                      </span>
                      <div className="relative w-24 shrink-0">
                        <Input
                          type="number"
                          inputMode="numeric"
                          className="font-qty pr-6"
                          value={actualG[line.rawMaterialId] ?? ""}
                          onChange={(e) =>
                            setActualG((prev) => ({
                              ...prev,
                              [line.rawMaterialId]: e.target.value,
                            }))
                          }
                        />
                        <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">
                          g
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {serverError && (
                  <p className="text-destructive text-sm">{serverError}</p>
                )}

                <Button
                  disabled={!canConfirm}
                  onClick={handleConfirm}
                  className="justify-self-start"
                >
                  {isSubmitting ? "Confirming…" : "Confirm"}
                </Button>
              </>
            ) : (
              <p className="text-destructive text-sm">
                Couldn&apos;t load this batch.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
