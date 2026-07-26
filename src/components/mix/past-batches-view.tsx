"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star, History } from "lucide-react";
import { rateBatch } from "@/app/(app)/mix/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatGrams } from "@/lib/units";

type BatchRow = {
  id: string;
  batchNo: string;
  flavourName: string;
  versionNo: number | null;
  outputG: number;
  mixedByName: string;
  mixedAt: string | null;
  rating: number | null;
  feedback: string | null;
};

type ScoreboardRow = {
  id: string;
  flavourName: string;
  versionNo: number;
  status: "current" | "archived";
  note: string;
  batchCount: number;
  avgRating: number | null;
};

function Stars({ value }: { value: number }) {
  return (
    <span className="text-primary inline-flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className="size-3.5"
          fill={i < value ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

function RatingCell({ batch }: { batch: BatchRow }) {
  const router = useRouter();
  const [rating, setRating] = React.useState(0);
  const [note, setNote] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (batch.rating != null) {
    return (
      <div className="grid gap-0.5">
        <Stars value={batch.rating} />
        {batch.feedback && (
          <span className="text-muted-foreground text-xs">
            {batch.feedback}
          </span>
        )}
      </div>
    );
  }

  async function handleSave() {
    if (rating < 1) return;
    setError(null);
    setIsSubmitting(true);
    const result = await rateBatch(batch.id, rating, note);
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setRating(i + 1)}
            aria-label={`Rate ${i + 1} out of 5`}
          >
            <Star
              className="text-primary size-4"
              fill={i < rating ? "currentColor" : "none"}
            />
          </button>
        ))}
      </div>
      {rating > 0 && (
        <div className="flex items-center gap-1.5">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            className="h-7 w-36 text-xs"
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={isSubmitting}
            onClick={handleSave}
          >
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

export function PastBatchesView({
  batches,
  scoreboard,
}: {
  batches: BatchRow[];
  scoreboard: ScoreboardRow[];
}) {
  const batchColumns: DataTableColumn<BatchRow>[] = [
    { key: "batchNo", header: "Batch", render: (b) => b.batchNo },
    { key: "flavour", header: "Flavour", render: (b) => b.flavourName },
    {
      key: "version",
      header: "Version",
      render: (b) => (b.versionNo ? `v${b.versionNo}` : "—"),
    },
    {
      key: "qty",
      header: "Quantity",
      numeric: true,
      render: (b) => formatGrams(b.outputG),
    },
    { key: "mixedBy", header: "Mixed by", render: (b) => b.mixedByName },
    {
      key: "date",
      header: "Date",
      render: (b) =>
        b.mixedAt
          ? new Date(b.mixedAt).toLocaleDateString("en-IN", {
              dateStyle: "medium",
            })
          : "—",
    },
    {
      key: "rating",
      header: "Rating",
      render: (b) => <RatingCell batch={b} />,
    },
  ];

  const scoreboardColumns: DataTableColumn<ScoreboardRow>[] = [
    { key: "flavour", header: "Flavour", render: (v) => v.flavourName },
    { key: "version", header: "Version", render: (v) => `v${v.versionNo}` },
    { key: "summary", header: "Mix summary", render: (v) => v.note },
    {
      key: "count",
      header: "Batches",
      numeric: true,
      render: (v) => v.batchCount,
    },
    {
      key: "avgRating",
      header: "Avg rating",
      render: (v) => (v.avgRating != null ? v.avgRating.toFixed(1) : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (v) => <StatusTag status={v.status} />,
    },
  ];

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="grid gap-4">
        <PageHeader title="Past batches" />
        {batches.length === 0 ? (
          <EmptyState
            icon={History}
            title="No confirmed batches yet"
            description="Batches show up here once they're confirmed on Make a batch."
          />
        ) : (
          <DataTable
            columns={batchColumns}
            data={batches}
            getRowKey={(b) => b.id}
          />
        )}
      </div>

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Version scoreboard
        </h2>
        {scoreboard.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                No recipe versions yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <DataTable
            columns={scoreboardColumns}
            data={scoreboard}
            getRowKey={(v) => v.id}
          />
        )}
      </div>
    </div>
  );
}
