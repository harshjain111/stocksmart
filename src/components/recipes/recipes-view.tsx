"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FlaskConical,
  Pencil,
  RotateCcw,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  getVersionDetail,
  rollbackRecipeVersion,
} from "@/app/(app)/recipes/actions";
import { createFlavour } from "@/app/(app)/setup/materials/flavour-actions";
import {
  createFlavourSchema,
  type CreateFlavourInput,
} from "@/lib/validation/flavours";
import { PageHeader } from "@/components/shared/page-header";
import { StatusTag } from "@/components/shared/status-tag";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
type Supplier = { id: string; name: string };

type VersionDetail = {
  note: string;
  createdAt: string;
  createdByName: string;
  wastagePct: number;
  lines: { rawMaterialId: string; materialName: string; percentage: number }[];
};

// Cycled across a recipe's ingredient lines so the percentage breakdown
// reads as a real chart. Tailwind only generates CSS for class names it can
// find as literal text in source — these must stay written out in full
// (never built at runtime via string concatenation/replace), one array per
// CSS property, kept in the same order.
const SEGMENT_COLORS = [
  "bg-primary",
  "bg-[var(--color-accent-solid)]",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
];
const SEGMENT_STROKE_COLORS = [
  "stroke-primary",
  "stroke-[var(--color-accent-solid)]",
  "stroke-chart-3",
  "stroke-chart-4",
  "stroke-chart-5",
];

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// r chosen so 2πr ≈ 100 — each segment's stroke-dasharray can then use its
// percentage directly, no extra math to convert to arc length.
const DONUT_RADIUS = 15.915;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function IngredientDonutChart({
  lines,
}: {
  lines: { materialName: string; percentage: number }[];
}) {
  let cumulative = 0;
  const segments = lines.map((line, i) => {
    const offset = cumulative;
    cumulative += line.percentage;
    return {
      ...line,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      strokeColor: SEGMENT_STROKE_COLORS[i % SEGMENT_STROKE_COLORS.length],
      offset,
    };
  });

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <svg
        viewBox="0 0 36 36"
        className="size-36 shrink-0 -rotate-90"
        role="img"
        aria-label="Ingredient percentage breakdown"
      >
        <circle
          cx="18"
          cy="18"
          r={DONUT_RADIUS}
          fill="none"
          className="stroke-muted"
          strokeWidth="4"
        />
        {segments.map((s) => (
          <circle
            key={s.materialName}
            cx="18"
            cy="18"
            r={DONUT_RADIUS}
            fill="none"
            strokeWidth="4"
            strokeLinecap="butt"
            className={cn(s.strokeColor, "transition-all")}
            strokeDasharray={`${(s.percentage / 100) * DONUT_CIRCUMFERENCE} ${DONUT_CIRCUMFERENCE}`}
            strokeDashoffset={-(s.offset / 100) * DONUT_CIRCUMFERENCE}
          />
        ))}
      </svg>
      <div className="grid w-full gap-2.5">
        {segments.map((s) => (
          <div
            key={s.materialName}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <span
                className={cn("size-2.5 shrink-0 rounded-full", s.color)}
              />
              <span className="font-medium">{s.materialName}</span>
            </span>
            <span className="font-qty">{s.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RecipesView({
  flavours,
  versions,
  materials,
  suppliers,
  canCreateVersion,
}: {
  flavours: Flavour[];
  versions: VersionSummary[];
  materials: Material[];
  suppliers: Supplier[];
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
  const [newFlavourOpen, setNewFlavourOpen] = React.useState(false);
  const [archivedOpen, setArchivedOpen] = React.useState(false);
  const [rollbackTarget, setRollbackTarget] =
    React.useState<VersionSummary | null>(null);
  const [pendingSelectFlavourId, setPendingSelectFlavourId] = React.useState<
    string | null
  >(null);

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

  const selectVersion = React.useCallback(async (versionId: string) => {
    setSelectedVersionId(versionId);
    setDetail(null);
    setLoadingDetail(true);
    const result = await getVersionDetail(versionId);
    setLoadingDetail(false);
    if (result.success) setDetail(result.data);
  }, []);

  function selectFlavour(flavourId: string) {
    setSelectedFlavourId(flavourId);
    setSelectedVersionId(null);
    setDetail(null);
  }

  // Land straight on the recipe instead of an empty panel — the current
  // version if there is one, otherwise the newest.
  React.useEffect(() => {
    if (selectedVersionId) return;
    if (flavourVersions.length === 0) return;
    const target =
      flavourVersions.find((v) => v.status === "current") ??
      flavourVersions[0];
    selectVersion(target.id);
  }, [flavourVersions, selectedVersionId, selectVersion]);

  // After a newly-created flavour comes back through props (post
  // router.refresh()), select it automatically.
  React.useEffect(() => {
    if (!pendingSelectFlavourId) return;
    const found = flavours.find((f) => f.id === pendingSelectFlavourId);
    if (found) {
      selectFlavour(found.id);
      setPendingSelectFlavourId(null);
    }
  }, [flavours, pendingSelectFlavourId]);

  if (flavours.length === 0 && !canCreateVersion) {
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
        action={
          canCreateVersion && (
            <Button variant="outline" onClick={() => setNewFlavourOpen(true)}>
              <Plus /> New flavour
            </Button>
          )
        }
      />

      {flavours.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No flavours yet"
          description="Add your first flavour, then give it a recipe."
          actionLabel="New flavour"
          onAction={() => setNewFlavourOpen(true)}
        />
      ) : (
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
                    <button
                      type="button"
                      onClick={() => setArchivedOpen((v) => !v)}
                      className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 px-3 py-1 text-xs font-medium tracking-wide uppercase"
                    >
                      {archivedOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                      Archived ({archivedFlavours.length})
                    </button>
                    {archivedOpen &&
                      archivedFlavours.map((f) => (
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
                    <span className="font-qty font-medium">
                      v{v.version_no}
                    </span>
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
                        <IngredientDonutChart lines={detail.lines} />
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
                                {selectedVersionSummary.version_no} current
                                again
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
      )}

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
          suppliers={suppliers}
          prefillWastagePct={detail?.wastagePct ?? 2}
          prefillLines={
            detail?.lines.map((l) => ({
              rawMaterialId: l.rawMaterialId,
              percentage: l.percentage,
            })) ?? []
          }
        />
      )}

      {canCreateVersion && (
        <NewFlavourDialog
          open={newFlavourOpen}
          onOpenChange={setNewFlavourOpen}
          onCreated={(id) => {
            setPendingSelectFlavourId(id);
            router.refresh();
          }}
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
        selected
          ? "bg-primary/10 text-primary"
          : "hover:bg-muted text-foreground",
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
          className={cn(
            "truncate",
            !flavour.is_active && "text-muted-foreground",
          )}
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

function NewFlavourDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateFlavourInput>({
    resolver: zodResolver(createFlavourSchema),
    defaultValues: { name: "" },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);

  async function onSubmit(values: CreateFlavourInput) {
    setServerError(null);
    const result = await createFlavour(values);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    reset();
    onOpenChange(false);
    if (result.data) onCreated(result.data.id);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New flavour</DialogTitle>
          <DialogDescription>
            Give it a name — you&apos;ll build its recipe right after.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="new-flavour-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="new-flavour-name">Name</Label>
            <Input id="new-flavour-name" {...register("name")} autoFocus />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-flavour-form"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating…" : "Create flavour"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
