"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Pencil, RotateCcw, Search } from "lucide-react";
import {
  getVersionDetail,
  rollbackRecipeVersion,
} from "@/app/(app)/recipes/actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusTag } from "@/components/shared/status-tag";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NewVersionDialog } from "@/components/recipes/new-version-dialog";

type Flavour = {
  id: string;
  code: string | null;
  name: string;
  is_active: boolean;
  current_version_id: string | null;
};

type VersionSummary = {
  id: string;
  flavour_id: string;
  version_no: number;
  status: "current" | "archived";
  created_at: string;
  batchCount: number;
};

type Material = { id: string; name: string };

type VersionDetail = {
  note: string;
  createdAt: string;
  createdByName: string;
  wastagePct: number;
  lines: { rawMaterialId: string; materialName: string; percentage: number }[];
};

// Cycled across a recipe's ingredient lines so the percentage breakdown
// reads as a real chart rather than a wall of identical bars.
const SEGMENT_COLORS = [
  "bg-primary",
  "bg-[var(--color-accent-solid)]",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
];

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function RecipesView({
  flavours,
  versions,
  materials,
  canCreateVersion,
}: {
  flavours: Flavour[];
  versions: VersionSummary[];
  materials: Material[];
  canCreateVersion: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [selectedFlavourId, setSelectedFlavourId] = React.useState<
    string | null
  >(flavours.find((f) => f.is_active)?.id ?? flavours[0]?.id ?? null);
  const [selectedVersionId, setSelectedVersionId] = React.useState<
    string | null
  >(null);
  const [detail, setDetail] = React.useState<VersionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [newVersionOpen, setNewVersionOpen] = React.useState(false);
  const [rollbackTarget, setRollbackTarget] =
    React.useState<VersionSummary | null>(null);

  const filteredFlavours = flavours.filter((f) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      f.name.toLowerCase().includes(q) ||
      (f.code ?? "").toLowerCase().includes(q)
    );
  });
  const activeFlavours = filteredFlavours.filter((f) => f.is_active);
  const archivedFlavours = filteredFlavours.filter((f) => !f.is_active);

  const flavourVersions = versions
    .filter((v) => v.flavour_id === selectedFlavourId)
    .sort((a, b) => b.version_no - a.version_no);

  const nextVersionNo = (flavourVersions[0]?.version_no ?? 0) + 1;
  const selectedFlavour = flavours.find((f) => f.id === selectedFlavourId);
  const selectedVersionSummary = flavourVersions.find(
    (v) => v.id === selectedVersionId,
  );

  async function selectVersion(versionId: string) {
    setSelectedVersionId(versionId);
    setDetail(null);
    setLoadingDetail(true);
    const result = await getVersionDetail(versionId);
    setLoadingDetail(false);
    if (result.success) setDetail(result.data);
  }

  function selectFlavour(flavourId: string) {
    setSelectedFlavourId(flavourId);
    setSelectedVersionId(null);
    setDetail(null);
  }

  if (flavours.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Recipes" />
        <EmptyState
          icon={FlaskConical}
          title="No flavours yet"
          description="Add a flavour under Setup > Materials & flavours, then come back here to give it a recipe."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Recipes"
        description="Versions are frozen the moment they're saved — there is no edit path, only a new version."
      />

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="grid gap-3">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search flavours…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Card className="h-fit max-h-[calc(100vh-16rem)] overflow-y-auto">
            <CardContent className="grid gap-1 p-2">
              {filteredFlavours.length === 0 && (
                <p className="text-muted-foreground p-3 text-sm">
                  No flavours match &ldquo;{search}&rdquo;.
                </p>
              )}
              {activeFlavours.map((f) => (
                <FlavourRow
                  key={f.id}
                  flavour={f}
                  selected={f.id === selectedFlavourId}
                  onSelect={() => selectFlavour(f.id)}
                />
              ))}
              {archivedFlavours.length > 0 && (
                <>
                  <p className="text-muted-foreground mt-2 px-3 text-xs font-medium tracking-wide uppercase">
                    Archived ({archivedFlavours.length})
                  </p>
                  {archivedFlavours.map((f) => (
                    <FlavourRow
                      key={f.id}
                      flavour={f}
                      selected={f.id === selectedFlavourId}
                      onSelect={() => selectFlavour(f.id)}
                    />
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {flavourVersions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => selectVersion(v.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-all",
                    v.id === selectedVersionId
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "hover:bg-muted border-transparent",
                  )}
                >
                  <span className="font-qty font-medium">v{v.version_no}</span>
                  <StatusTag status={v.status} />
                  <span className="text-muted-foreground text-xs">
                    {v.batchCount} batch{v.batchCount === 1 ? "" : "es"}
                  </span>
                </button>
              ))}
            </div>
            {canCreateVersion && selectedFlavour && (
              <Button
                onClick={() => setNewVersionOpen(true)}
                disabled={materials.length === 0}
                title={
                  materials.length === 0
                    ? "Add a raw material first"
                    : undefined
                }
              >
                <Pencil />
                {flavourVersions.length === 0
                  ? "Create first recipe"
                  : `New version → v${nextVersionNo}`}
              </Button>
            )}
          </div>

          {flavourVersions.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              title="No recipe yet"
              description={
                canCreateVersion
                  ? `This flavour has no recipe yet — use “Create first recipe” above to give it one.`
                  : "This flavour has no recipe versions yet."
              }
            />
          ) : (
            selectedVersionId && (
              <Card>
                <CardContent className="grid gap-4">
                  {loadingDetail ? (
                    <div className="grid gap-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  ) : detail ? (
                    <>
                      <div className="grid gap-3">
                        {detail.lines.map((line, i) => (
                          <div key={line.materialName} className="grid gap-1.5">
                            <div className="flex items-baseline justify-between text-sm">
                              <span className="font-medium">
                                {line.materialName}
                              </span>
                              <span className="font-qty">
                                {line.percentage}%
                              </span>
                            </div>
                            <div className="bg-muted h-2.5 overflow-hidden rounded-full">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                                )}
                                style={{ width: `${line.percentage}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border-t pt-3 text-sm">
                        <p className="text-muted-foreground italic">
                          &ldquo;{detail.note}&rdquo;
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {detail.createdByName} ·{" "}
                          {new Date(detail.createdAt).toLocaleDateString(
                            "en-IN",
                          )}{" "}
                          · {detail.wastagePct}% wastage
                        </p>
                        {canCreateVersion &&
                          selectedVersionSummary?.status === "archived" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() =>
                                setRollbackTarget(selectedVersionSummary)
                              }
                            >
                              <RotateCcw /> Make v
                              {selectedVersionSummary.version_no} current again
                            </Button>
                          )}
                      </div>
                    </>
                  ) : (
                    <p className="text-destructive text-sm">
                      Couldn&apos;t load this version.
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          )}
        </div>
      </div>

      {canCreateVersion && selectedFlavour && (
        <NewVersionDialog
          // Remount with fresh initial state whenever the selected
          // flavour/version changes — the dialog's fields are seeded once
          // from props via useState, so without this key a later selection
          // change wouldn't refresh a still-mounted dialog's prefill.
          key={`${selectedFlavour.id}-${selectedVersionId ?? "none"}`}
          open={newVersionOpen}
          onOpenChange={setNewVersionOpen}
          flavourId={selectedFlavour.id}
          flavourName={selectedFlavour.name}
          nextVersionNo={nextVersionNo}
          materials={materials}
          prefillWastagePct={detail?.wastagePct ?? 2}
          prefillLines={
            detail?.lines.map((l) => ({
              rawMaterialId: l.rawMaterialId,
              percentage: l.percentage,
            })) ?? []
          }
        />
      )}

      {rollbackTarget && (
        <ConfirmDialog
          open={!!rollbackTarget}
          onOpenChange={(open) => !open && setRollbackTarget(null)}
          title={`Make v${rollbackTarget.version_no} current again`}
          description="No data is copied or changed — this just flips which version is current. The version now active gets archived."
          confirmPhrase={`v${rollbackTarget.version_no}`}
          confirmLabel="Make current"
          destructive={false}
          onConfirm={async () => {
            const result = await rollbackRecipeVersion(rollbackTarget.id);
            if (!result.success) throw new Error(result.error);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function FlavourRow({
  flavour,
  selected,
  onSelect,
}: {
  flavour: Flavour;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition-colors",
        selected ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          selected
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground",
        )}
      >
        {initials(flavour.name)}
      </span>
      <span className="grid min-w-0 flex-1">
        <span
          className={cn("truncate", !flavour.is_active && "text-muted-foreground")}
        >
          {flavour.name}
        </span>
        <span className="text-muted-foreground truncate text-xs font-normal">
          {flavour.code}
        </span>
      </span>
    </button>
  );
}
