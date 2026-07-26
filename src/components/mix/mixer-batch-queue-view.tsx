"use client";

import * as React from "react";
import { FlaskConical } from "lucide-react";
import {
  listDraftBatchesForMixer,
  getMaskedBatchCard,
} from "@/app/(app)/mix/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
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

type MaskedLine = {
  rawMaterialId: string;
  code: string | null;
  plannedG: number;
};

export function MixerBatchQueueView() {
  const [batches, setBatches] = React.useState<BatchSummary[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [card, setCard] = React.useState<{
    batchNo: string;
    flavourName: string;
    outputG: number;
    lines: MaskedLine[];
  } | null>(null);
  const [loadingCard, setLoadingCard] = React.useState(false);
  const [ticked, setTicked] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    listDraftBatchesForMixer().then((result) => {
      setLoadingList(false);
      if (result.success) setBatches(result.data);
    });
  }, []);

  async function selectBatch(id: string) {
    setSelectedId(id);
    setCard(null);
    setTicked({});
    setLoadingCard(true);
    const result = await getMaskedBatchCard(id);
    setLoadingCard(false);
    if (result.success) setCard(result.data);
  }

  const allTicked =
    !!card &&
    card.lines.length > 0 &&
    card.lines.every((l) => ticked[l.rawMaterialId]);

  if (loadingList) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Batches to mix" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Batches to mix" />
        <EmptyState
          icon={FlaskConical}
          title="Nothing waiting to be mixed"
          description="Draft batches created for your branch will show up here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Batches to mix"
        description="Weigh each component, tick it off, then confirm."
      />

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
                Select a batch to see what to weigh.
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
                    <label
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
                      <div className="flex flex-1 items-baseline justify-between">
                        <span className="font-qty text-sm font-medium">
                          {line.code ?? "—"}
                        </span>
                        <span className="font-qty text-sm">
                          {formatGrams(line.plannedG)}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>

                {allTicked && (
                  <p className="text-muted-foreground text-sm">
                    All components weighed. Confirming a batch isn&apos;t wired
                    up yet — coming next.
                  </p>
                )}

                <Button disabled={!allTicked} className="justify-self-start">
                  Confirm
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
