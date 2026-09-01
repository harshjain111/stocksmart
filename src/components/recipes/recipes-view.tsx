"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  AlertCircle,
  Box,
  FileCheck2,
  AlertTriangle,
  BarChart3,
  RotateCcw,
  History,
  ArrowRight,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { createFlavour } from "@/app/(app)/setup/materials/flavour-actions";
import {
  createFlavourSchema,
  type CreateFlavourInput,
} from "@/lib/validation/flavours";
import { rollbackRecipeVersion } from "@/app/(app)/recipes/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { NewVersionDialog } from "@/components/recipes/new-version-dialog";
import { formatGrams } from "@/lib/units";

export type FlavourRow = {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  currentVersion: {
    id: string;
    versionNo: number;
    wastagePct: number;
    note: string;
    createdAt: string;
    createdByName: string;
    lines: { rawMaterialId: string; materialName: string; percentage: number }[];
    batchCount: number;
  } | null;
  archivedVersions: {
    id: string;
    versionNo: number;
    createdAt: string;
    createdByName: string;
    note: string;
    batchCount: number;
  }[];
  totalBatches: number;
  totalProducedG: number;
  recentBatches: {
    id: string;
    batchNo: string;
    mixedAt: string | null;
    outputG: number;
  }[];
  lastBatchAt: string | null;
};

export type AttentionItem = { flavourId: string; flavourName: string; reason: string };

type Material = { id: string; name: string };
type Supplier = { id: string; name: string };

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function batchLabel(batchNo: string) {
  const match = batchNo.match(/(\d+)$/);
  return match ? `#${parseInt(match[1], 10)}` : batchNo;
}

const FILTERS = ["All", "Recipe Set", "No Recipe", "Recently Changed", "Active"] as const;
type FilterKey = (typeof FILTERS)[number];

const SORTS = ["Most Batches", "Name A–Z", "Recently Updated"] as const;
type SortKey = (typeof SORTS)[number];

// Deterministic per-flavour tint for the initials avatar — small purple,
// teal, amber, green and red accents, never re-derived from index order so
// a flavour keeps the same colour as the list is filtered/sorted.
const AVATAR_TONES = [
  "bg-primary",
  "bg-info",
  "bg-warning",
  "bg-success",
  "bg-destructive",
  "bg-accent-solid",
];
function avatarTone(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function RecipesView({
  flavours,
  attentionItems,
  kpis,
  materials,
  suppliers,
  canCreateVersion,
}: {
  flavours: FlavourRow[];
  attentionItems: AttentionItem[];
  kpis: {
    totalFlavours: number;
    recipesSet: number;
    noRecipe: number;
    totalBatches: number;
  };
  materials: Material[];
  suppliers: Supplier[];
  canCreateVersion: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<FilterKey>("All");
  const [attentionOnly, setAttentionOnly] = React.useState(false);
  const [sort, setSort] = React.useState<SortKey>("Most Batches");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [newFlavourOpen, setNewFlavourOpen] = React.useState(false);
  const [versionDialogFlavourId, setVersionDialogFlavourId] = React.useState<
    string | null
  >(null);
  const [historyFlavourId, setHistoryFlavourId] = React.useState<string | null>(
    null,
  );
  const [rollbackTarget, setRollbackTarget] = React.useState<{
    id: string;
    versionNo: number;
  } | null>(null);
  const [pendingSelectFlavourId, setPendingSelectFlavourId] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    if (!pendingSelectFlavourId) return;
    const found = flavours.find((f) => f.id === pendingSelectFlavourId);
    if (found) {
      setExpandedId(found.id);
      setPendingSelectFlavourId(null);
    }
  }, [flavours, pendingSelectFlavourId]);

  const attentionFlavourIds = new Set(attentionItems.map((a) => a.flavourId));

  const filtered = flavours.filter((f) => {
    if (!f.isActive) return false;
    if (attentionOnly && !attentionFlavourIds.has(f.id)) return false;
    const q = search.trim().toLowerCase();
    if (
      q &&
      !(f.name.toLowerCase().includes(q) || (f.code ?? "").toLowerCase().includes(q))
    )
      return false;
    if (filter === "Recipe Set" && !f.currentVersion) return false;
    if (filter === "No Recipe" && f.currentVersion) return false;
    if (filter === "Recently Changed") {
      if (!f.currentVersion) return false;
      const days =
        (Date.now() - new Date(f.currentVersion.createdAt).getTime()) /
        (1000 * 60 * 60 * 24);
      if (days > 30) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "Most Batches") return b.totalBatches - a.totalBatches;
    if (sort === "Name A–Z") return a.name.localeCompare(b.name);
    const at = a.currentVersion?.createdAt ?? "";
    const bt = b.currentVersion?.createdAt ?? "";
    return bt.localeCompare(at);
  });

  const versionDialogFlavour = flavours.find((f) => f.id === versionDialogFlavourId) ?? null;
  const historyFlavour = flavours.find((f) => f.id === historyFlavourId) ?? null;

  async function handleRollback() {
    if (!rollbackTarget) return;
    const result = await rollbackRecipeVersion(rollbackTarget.id);
    if (result.success) {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="Recipes"
        description="Manage flavour formulas, recipe versions and production history."
        action={
          canCreateVersion && (
            <Button onClick={() => setNewFlavourOpen(true)}>
              <Plus /> New flavour
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={Box} tone="info" value={kpis.totalFlavours} label="Total Flavours" />
        <KpiCard icon={FileCheck2} tone="success" value={kpis.recipesSet} label="Recipes Set" />
        <KpiCard icon={AlertTriangle} tone="warning" value={kpis.noRecipe} label="No Recipe" />
        <KpiCard icon={BarChart3} tone="primary" value={kpis.totalBatches} label="Total Batches" />
      </div>

      {attentionItems.length > 0 && (
        <div className="border-info/25 bg-info/5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border px-4 py-2.5 text-sm">
          <AlertCircle className="text-info size-4 shrink-0" />
          <span className="font-medium">
            {attentionItems.length} flavour{attentionItems.length === 1 ? "" : "s"} need
            attention
          </span>
          {attentionItems.slice(0, 3).map((a) => (
            <span key={a.flavourId} className="text-muted-foreground flex items-center gap-2">
              <span aria-hidden className="text-border">
                •
              </span>
              {a.flavourName} — {a.reason}
            </span>
          ))}
          <button
            type="button"
            onClick={() => {
              setAttentionOnly((v) => !v);
              setFilter("All");
            }}
            className="text-primary ml-auto flex items-center gap-1 font-medium hover:underline"
          >
            {attentionOnly ? "Show all" : "View all"}
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search flavours…"
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg border p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                  filter === f
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground text-xs whitespace-nowrap">Sort by</Label>
          <Select
            items={SORTS.map((s) => ({ value: s, label: s }))}
            value={sort}
            onValueChange={(v) => v && setSort(v as SortKey)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={Box}
          title={flavours.length === 0 ? "No flavours yet" : "No matches"}
          description={
            flavours.length === 0
              ? "Add your first flavour to get started."
              : "Try a different search or filter."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="bg-muted/40 border-b text-left text-xs">
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Flavour</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Recipe (Current)</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Version</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Batches</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Last Updated</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <FlavourTableRow
                  key={f.id}
                  flavour={f}
                  expanded={expandedId === f.id}
                  onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
                  onSetRecipe={() => setVersionDialogFlavourId(f.id)}
                  onNewVersion={() => setVersionDialogFlavourId(f.id)}
                  onVersionHistory={() => setHistoryFlavourId(f.id)}
                  canCreateVersion={canCreateVersion}
                />
              ))}
            </tbody>
          </table>
        </div>
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

      {canCreateVersion && versionDialogFlavour && (
        <NewVersionDialog
          key={`${versionDialogFlavour.id}-${versionDialogFlavour.currentVersion?.id ?? "none"}`}
          open={!!versionDialogFlavourId}
          onOpenChange={(open) => !open && setVersionDialogFlavourId(null)}
          flavourId={versionDialogFlavour.id}
          flavourName={versionDialogFlavour.name}
          nextVersionNo={(versionDialogFlavour.currentVersion?.versionNo ?? 0) + 1}
          materials={materials}
          suppliers={suppliers}
          prefillWastagePct={versionDialogFlavour.currentVersion?.wastagePct ?? 2}
          prefillLines={
            versionDialogFlavour.currentVersion?.lines.map((l) => ({
              rawMaterialId: l.rawMaterialId,
              percentage: l.percentage,
            })) ?? []
          }
        />
      )}

      <VersionHistoryDialog
        flavour={historyFlavour}
        open={!!historyFlavourId}
        onOpenChange={(open) => !open && setHistoryFlavourId(null)}
        onRollback={(id, versionNo) => setRollbackTarget({ id, versionNo })}
        canRollback={canCreateVersion}
      />

      <ConfirmDialog
        open={!!rollbackTarget}
        onOpenChange={(open) => !open && setRollbackTarget(null)}
        title={`Make v${rollbackTarget?.versionNo} current again?`}
        description="This makes the selected version current without editing it — it stays exactly as it was saved."
        confirmPhrase={`v${rollbackTarget?.versionNo ?? ""}`}
        confirmLabel="Make current"
        destructive={false}
        onConfirm={handleRollback}
      />
    </div>
  );
}

function KpiCard({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: LucideIcon;
  tone: "info" | "success" | "warning" | "primary";
  value: number;
  label: string;
}) {
  const toneClasses: Record<string, string> = {
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    primary: "bg-primary/10 text-primary",
  };
  return (
    <div className="bg-card flex items-center gap-3 rounded-lg border p-4">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          toneClasses[tone],
        )}
      >
        <Icon className="size-5" />
      </span>
      <div>
        <p className="font-heading text-2xl leading-none font-semibold tabular-nums">
          {value}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">{label}</p>
      </div>
    </div>
  );
}

function FlavourTableRow({
  flavour,
  expanded,
  onToggle,
  onSetRecipe,
  onNewVersion,
  onVersionHistory,
  canCreateVersion,
}: {
  flavour: FlavourRow;
  expanded: boolean;
  onToggle: () => void;
  onSetRecipe: () => void;
  onNewVersion: () => void;
  onVersionHistory: () => void;
  canCreateVersion: boolean;
}) {
  const cv = flavour.currentVersion;
  const ingredientSummary = cv
    ? cv.lines
        .slice(0, 4)
        .map((l) => `${l.materialName} ${l.percentage}%`)
        .join(" · ") + (cv.lines.length > 4 ? ` +${cv.lines.length - 4}` : "")
    : null;

  return (
    <>
      <tr
        className={cn(
          "hover:bg-muted/30 cursor-pointer border-b transition-colors last:border-0",
          expanded && "bg-muted/20",
        )}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
                avatarTone(flavour.id),
              )}
            >
              {initials(flavour.name)}
            </span>
            <div>
              <p className="font-medium">{flavour.name}</p>
              <p className="text-muted-foreground text-xs">{flavour.code}</p>
            </div>
          </div>
        </td>
        <td className="max-w-64 px-4 py-3">
          {cv ? (
            <>
              <p className="text-xs font-medium">
                {cv.lines.length} ingredient{cv.lines.length === 1 ? "" : "s"}
              </p>
              <p className="text-muted-foreground truncate text-xs">{ingredientSummary}</p>
            </>
          ) : (
            <p className="text-destructive text-xs font-medium">No recipe set</p>
          )}
        </td>
        <td className="px-4 py-3">
          {cv ? (
            <span className="flex items-center gap-1.5">
              <span className="font-qty text-xs">v{cv.versionNo}</span>
              <StatusTag status="current" />
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <p className="font-qty text-xs">{flavour.totalBatches}</p>
          <p className="text-muted-foreground text-xs">Last: {fmtDate(flavour.lastBatchAt)}</p>
        </td>
        <td className="px-4 py-3">
          {cv ? (
            <>
              <p className="text-xs">{fmtDate(cv.createdAt)}</p>
              <p className="text-muted-foreground text-xs">by {cv.createdByName}</p>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {cv ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="bg-success inline-block size-1.5 rounded-full" /> Active
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="bg-destructive inline-block size-1.5 rounded-full" /> No recipe
            </span>
          )}
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            {!cv && canCreateVersion && (
              <Button size="sm" variant="secondary" onClick={onSetRecipe}>
                Set Recipe
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggle}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}
              >
                <MoreVertical className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {cv && canCreateVersion && (
                  <DropdownMenuItem onClick={onNewVersion}>
                    <Pencil /> New version
                  </DropdownMenuItem>
                )}
                {flavour.archivedVersions.length > 0 && (
                  <DropdownMenuItem onClick={onVersionHistory}>
                    <History /> Version history
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b last:border-0">
          <td colSpan={7} className="bg-muted/10 p-0">
            <ExpandedPanel
              flavour={flavour}
              onNewVersion={onNewVersion}
              onSetRecipe={onSetRecipe}
              onVersionHistory={onVersionHistory}
              canCreateVersion={canCreateVersion}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedPanel({
  flavour,
  onNewVersion,
  onSetRecipe,
  onVersionHistory,
  canCreateVersion,
}: {
  flavour: FlavourRow;
  onNewVersion: () => void;
  onSetRecipe: () => void;
  onVersionHistory: () => void;
  canCreateVersion: boolean;
}) {
  const cv = flavour.currentVersion;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1.3fr_1.3fr_0.7fr]">
      <div className="bg-card rounded-lg border p-4">
        {cv ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="font-heading text-sm font-semibold">
                Current Recipe (v{cv.versionNo})
              </h3>
              <StatusTag status="current" />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="pb-1.5 text-left font-medium">Raw Material</th>
                  <th className="pb-1.5 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {cv.lines.map((l) => (
                  <tr key={l.rawMaterialId} className="border-b last:border-0">
                    <td className="py-1.5">{l.materialName}</td>
                    <td className="font-qty py-1.5 text-right">{l.percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 grid gap-1 text-xs">
              <p>
                <span className="text-muted-foreground">Wastage Allowance:</span>{" "}
                <span className="font-qty">{cv.wastagePct}%</span>
              </p>
              <p className="text-muted-foreground">
                Created on: {fmtDate(cv.createdAt)} by {cv.createdByName}
              </p>
            </div>
          </>
        ) : (
          <EmptyState
            icon={AlertTriangle}
            title="No recipe yet"
            description="Use Set Recipe to give this flavour a formula."
          />
        )}
      </div>

      <div className="bg-card rounded-lg border p-4">
        <h3 className="font-heading mb-3 text-sm font-semibold">Production Summary</h3>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="bg-muted/40 rounded-md p-3">
            <p className="font-heading text-xl font-semibold tabular-nums">
              {flavour.totalBatches}
            </p>
            <p className="text-muted-foreground text-xs">Total Batches</p>
          </div>
          <div className="bg-muted/40 rounded-md p-3">
            <p className="font-heading text-xl font-semibold tabular-nums">
              {formatGrams(flavour.totalProducedG)}
            </p>
            <p className="text-muted-foreground text-xs">Total Produced</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <h4 className="text-muted-foreground text-xs font-semibold">Recent Batches</h4>
          <Link
            href="/mix/past-batches"
            className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
          >
            View all batches <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="mt-2 grid gap-1.5">
          {flavour.recentBatches.length === 0 ? (
            <p className="text-muted-foreground text-xs">No batches yet.</p>
          ) : (
            flavour.recentBatches.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-xs">
                <span className="font-qty">{batchLabel(b.batchNo)}</span>
                <span className="text-muted-foreground">{fmtDate(b.mixedAt)}</span>
                <span className="font-qty">{formatGrams(b.outputG)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg border p-4">
        <h3 className="font-heading mb-3 text-sm font-semibold">Actions</h3>
        <div className="grid gap-2">
          {canCreateVersion &&
            (cv ? (
              <Button onClick={onNewVersion}>
                <Pencil /> New Version
              </Button>
            ) : (
              <Button onClick={onSetRecipe}>
                <Plus /> Set Recipe
              </Button>
            ))}
          {flavour.archivedVersions.length > 0 && (
            <Button variant="outline" onClick={onVersionHistory}>
              <History /> Version History
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function VersionHistoryDialog({
  flavour,
  open,
  onOpenChange,
  onRollback,
  canRollback,
}: {
  flavour: FlavourRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRollback: (id: string, versionNo: number) => void;
  canRollback: boolean;
}) {
  if (!flavour) return null;

  const allVersions = [
    ...(flavour.currentVersion
      ? [{ ...flavour.currentVersion, status: "current" as const }]
      : []),
    ...flavour.archivedVersions.map((v) => ({ ...v, status: "archived" as const })),
  ].sort((a, b) => b.versionNo - a.versionNo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{flavour.name} — version history</DialogTitle>
          <DialogDescription>
            Every version is permanent — nothing here can be edited, only made current
            again.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-96 gap-2 overflow-y-auto">
          {allVersions.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-qty">v{v.versionNo}</span>
                  <StatusTag status={v.status} />
                </div>
                <p className="text-muted-foreground text-xs">
                  {fmtDate(v.createdAt)} by {v.createdByName} · {v.batchCount} batch
                  {v.batchCount === 1 ? "" : "es"}
                </p>
                {v.note && (
                  <p className="text-muted-foreground mt-0.5 text-xs italic">
                    &ldquo;{v.note}&rdquo;
                  </p>
                )}
              </div>
              {v.status === "archived" && canRollback && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRollback(v.id, v.versionNo)}
                >
                  <RotateCcw className="size-3.5" /> Make current
                </Button>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [serverError, setServerError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateFlavourInput>({
    resolver: zodResolver(createFlavourSchema),
    defaultValues: { name: "" },
  });

  React.useEffect(() => {
    if (open) {
      reset({ name: "" });
      setServerError(null);
    }
  }, [open, reset]);

  async function onSubmit(values: CreateFlavourInput) {
    setServerError(null);
    const result = await createFlavour(values);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    if (result.data) onCreated(result.data.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New flavour</DialogTitle>
          <DialogDescription>
            Creates the flavour master record — give it a recipe next.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" id="new-flavour-form">
          <div className="grid gap-1.5">
            <Label htmlFor="flavour-name">Name</Label>
            <Input id="flavour-name" autoFocus {...register("name")} />
            {errors.name && <p className="text-destructive text-sm">{errors.name.message}</p>}
          </div>
          {serverError && <p className="text-destructive text-sm">{serverError}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-flavour-form" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
