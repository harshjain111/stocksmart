"use client";

import * as React from "react";
import { TriangleAlert, FlaskConical, Scale, ListChecks, Percent } from "lucide-react";
import {
  getRecipeVersionForBatch,
  createDraftBatch,
} from "@/app/(app)/mix/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatGrams, kgToGrams } from "@/lib/units";

type Flavour = {
  id: string;
  code: string | null;
  name: string;
  current_version_id: string | null;
};

type VersionSummary = {
  id: string;
  flavour_id: string;
  version_no: number;
  status: "current" | "archived";
};

type Department = { id: string; name: string; branchName: string };

type BatchLine = {
  rawMaterialId: string;
  code: string | null;
  name: string;
  percentage: number;
};

export function MakeBatchView({
  flavours,
  versions,
  departments,
}: {
  flavours: Flavour[];
  versions: VersionSummary[];
  departments: Department[];
}) {
  const [flavourId, setFlavourId] = React.useState(flavours[0]?.id ?? "");
  const [versionId, setVersionId] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState(
    departments[0]?.id ?? "",
  );
  const [outputKg, setOutputKg] = React.useState("");
  const [wastagePct, setWastagePct] = React.useState<number | null>(null);
  const [lines, setLines] = React.useState<BatchLine[]>([]);
  const [loadingCard, setLoadingCard] = React.useState(false);
  const [ticked, setTicked] = React.useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [createdBatchNo, setCreatedBatchNo] = React.useState<string | null>(
    null,
  );

  const flavourVersions = versions
    .filter((v) => v.flavour_id === flavourId)
    .sort((a, b) => b.version_no - a.version_no);
  const selectedFlavour = flavours.find((f) => f.id === flavourId);
  const selectedVersion = flavourVersions.find((v) => v.id === versionId);

  async function loadCard(vId: string) {
    setLoadingCard(true);
    setLines([]);
    setTicked({});
    setCreatedBatchNo(null);
    const result = await getRecipeVersionForBatch(vId);
    setLoadingCard(false);
    if (result.success) {
      setWastagePct(result.data.wastagePct);
      setLines(result.data.lines);
    }
  }

  // Load the default version's card for whichever flavour is selected on
  // first render — selectFlavour() below only fires on a user-driven change.
  React.useEffect(() => {
    if (!flavourId) return;
    const flavour = flavours.find((f) => f.id === flavourId);
    const defaultVersionId =
      flavour?.current_version_id ??
      versions.find((v) => v.flavour_id === flavourId)?.id ??
      "";
    if (defaultVersionId) {
      setVersionId(defaultVersionId);
      loadCard(defaultVersionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectFlavour(id: string) {
    setFlavourId(id);
    const flavour = flavours.find((f) => f.id === id);
    const defaultVersionId =
      flavour?.current_version_id ??
      versions.find((v) => v.flavour_id === id)?.id ??
      "";
    setVersionId(defaultVersionId);
    setCreatedBatchNo(null);
    if (defaultVersionId) loadCard(defaultVersionId);
    else {
      setLines([]);
      setWastagePct(null);
    }
  }

  function selectVersion(id: string) {
    setVersionId(id);
    loadCard(id);
  }

  const outputG = outputKg ? kgToGrams(parseFloat(outputKg)) : 0;
  const wastageMultiplier = wastagePct !== null ? 1 + wastagePct / 100 : 1;
  const cardLines = lines.map((line) => ({
    ...line,
    plannedG: Math.round(outputG * (line.percentage / 100) * wastageMultiplier),
  }));
  const runningTotalG = cardLines.reduce((sum, l) => sum + l.plannedG, 0);

  const allTicked =
    cardLines.length > 0 && cardLines.every((l) => ticked[l.rawMaterialId]);
  const canConfirm =
    allTicked &&
    outputG > 0 &&
    !!versionId &&
    !!departmentId &&
    !loadingCard &&
    !isSubmitting;

  async function handleConfirm() {
    if (!canConfirm) return;
    setServerError(null);
    setIsSubmitting(true);
    const result = await createDraftBatch({
      flavourId,
      recipeVersionId: versionId,
      departmentId,
      outputG,
    });
    setIsSubmitting(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setCreatedBatchNo(result.data.batchNo);
    setOutputKg("");
    setTicked({});
  }

  if (flavours.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Make a batch" />
        <EmptyState
          icon={FlaskConical}
          title="No flavours yet"
          description="Add a flavour under Setup > Materials & flavours, then give it a recipe under Recipes."
        />
      </div>
    );
  }

  if (departments.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Make a batch" />
        <EmptyState
          icon={FlaskConical}
          title="No mixing department available"
          description="No department in your branch is flagged for mixing yet — ask an admin to enable it under Setup."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Make a batch"
        description="Pick a flavour and version, enter the output, then weigh and tick each component."
      />

      {cardLines.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            label="Running total"
            value={formatGrams(runningTotalG)}
            detail={`incl. ${wastagePct ?? 0}% wastage`}
            icon={Scale}
            tone="primary"
            className="col-span-2 sm:col-span-1"
          />
          <StatCard
            label="Components to weigh"
            value={String(cardLines.length)}
            icon={ListChecks}
          />
          <StatCard
            label="Wastage allowance"
            value={`${wastagePct ?? 0}%`}
            icon={Percent}
          />
        </div>
      )}

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label>Flavour</Label>
            <Select
              items={flavours.map((f) => ({
                value: f.id,
                label: f.code ? `${f.name} (${f.code})` : f.name,
              }))}
              value={flavourId}
              onValueChange={(v) => v && selectFlavour(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {flavours.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                    {f.code && (
                      <span className="text-muted-foreground"> ({f.code})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Recipe version</Label>
            <Select
              items={flavourVersions.map((v) => ({
                value: v.id,
                label: `v${v.version_no} (${v.status})`,
              }))}
              value={versionId}
              onValueChange={(v) => v && selectVersion(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a version" />
              </SelectTrigger>
              <SelectContent>
                {flavourVersions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    v{v.version_no} ({v.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Mixing department</Label>
            <Select
              items={departments.map((d) => ({
                value: d.id,
                label: `${d.name} (${d.branchName})`,
              }))}
              value={departmentId}
              onValueChange={(v) => v && setDepartmentId(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} ({d.branchName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="output-kg">Output</Label>
            <div className="relative">
              <Input
                id="output-kg"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                className="font-qty pr-9"
                value={outputKg}
                onChange={(e) => {
                  setOutputKg(e.target.value);
                  setTicked({});
                  setCreatedBatchNo(null);
                }}
              />
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
                kg
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedVersion?.status === "archived" && (
        <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-lg border p-3 text-sm">
          <TriangleAlert className="text-warning-foreground mt-0.5 size-4 shrink-0" />
          <p>
            This is not the current recipe — v{selectedVersion.version_no} is
            archived
            {selectedFlavour?.current_version_id &&
              flavourVersions.find(
                (v) => v.id === selectedFlavour.current_version_id,
              ) &&
              ` (current is v${
                flavourVersions.find(
                  (v) => v.id === selectedFlavour.current_version_id,
                )?.version_no
              })`}
            . Make sure mixing against an old formula is intentional.
          </p>
        </div>
      )}

      <Card>
        <CardContent className="grid gap-4">
          {loadingCard ? (
            <div className="grid gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : cardLines.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Select a flavour and version to see the batch card.
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                {cardLines.map((line) => (
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
                        {formatGrams(line.plannedG)}
                      </span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-baseline justify-between border-t pt-3">
                <span className="text-sm font-medium">
                  Running total (incl. {wastagePct}% wastage)
                </span>
                <span className="font-qty text-sm font-semibold">
                  {formatGrams(runningTotalG)}
                </span>
              </div>

              {serverError && (
                <p className="text-destructive text-sm">{serverError}</p>
              )}
              {createdBatchNo && (
                <p className="text-primary text-sm font-medium">
                  Draft batch {createdBatchNo} created.
                </p>
              )}

              <Button
                disabled={!canConfirm}
                onClick={handleConfirm}
                className="justify-self-start"
              >
                {isSubmitting ? "Confirming…" : "Confirm"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
