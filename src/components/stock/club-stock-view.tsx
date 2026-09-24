"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Users,
  Link2,
  TriangleAlert,
  CircleOff,
  Clock,
  RefreshCw,
  Info,
  Search,
  Martini,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatGrams } from "@/lib/units";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusTag } from "@/components/shared/status-tag";
import { EmptyState } from "@/components/shared/empty-state";
import {
  triggerClubSync,
  type ClubStockData,
  type ClubStockRowView,
} from "@/app/(app)/stock/club/actions";

const TONE_CLASSES: Record<string, string> = {
  info: "bg-info/10 text-info",
  warning: "bg-warning/20 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
  primary: "bg-primary/10 text-primary",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ClubGroup = {
  clubId: string;
  clubName: string;
  branchName: string;
  rows: ClubStockRowView[];
  out: number;
  low: number;
  approaching: number;
  ok: number;
};

export function ClubStockView({ data }: { data: ClubStockData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = React.useState(params.get("status") ?? "all");
  const [clubId, setClubId] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (clubId !== "all" && r.clubId !== clubId) return false;
      if (!term) return true;
      return (
        r.clubName.toLowerCase().includes(term) ||
        r.flavourName.toLowerCase().includes(term)
      );
    });
  }, [data.rows, status, clubId, search]);

  /**
   * One row per club, not one per club-and-flavour. A flat list repeats
   * the club name once for every flavour it stocks — sixteen clubs became
   * a hundred-odd near-identical rows where only the last two columns
   * changed. A club is the unit people actually ask about ("what is 188
   * Downtown short of?"), so it is the unit on screen and its flavours
   * live inside it.
   */
  const groups = React.useMemo<ClubGroup[]>(() => {
    const byClub = new Map<string, ClubGroup>();
    for (const row of filtered) {
      let group = byClub.get(row.clubId);
      if (!group) {
        group = {
          clubId: row.clubId,
          clubName: row.clubName,
          branchName: row.branchName,
          rows: [],
          out: 0,
          low: 0,
          approaching: 0,
          ok: 0,
        };
        byClub.set(row.clubId, group);
      }
      group.rows.push(row);
      group[row.status] += 1;
    }
    for (const group of byClub.values()) {
      group.rows.sort((a, b) => a.flavourName.localeCompare(b.flavourName));
    }

    // Trouble first: this screen is opened to find who needs restocking,
    // so a club that is fine should never sit above one that is empty.
    return [...byClub.values()].sort(
      (a, b) =>
        b.out - a.out ||
        b.low - a.low ||
        b.approaching - a.approaching ||
        a.clubName.localeCompare(b.clubName),
    );
  }, [filtered]);

  // Narrowing to one club, or searching, means you want to see the
  // matches — not to go opening each club by hand.
  const autoExpand =
    clubId !== "all" || search.trim() !== "" || status !== "all";
  const isOpen = (id: string) => autoExpand || expanded.has(id);
  const allOpen = groups.length > 0 && groups.every((g) => expanded.has(g.clubId));

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSync() {
    setIsSyncing(true);
    setSyncMessage(null);
    const result = await triggerClubSync();
    setIsSyncing(false);
    if (result.status === "success") {
      setSyncMessage(
        `Synced ${result.items} item${result.items === 1 ? "" : "s"} across ${result.clubs} club${result.clubs === 1 ? "" : "s"}.` +
          (result.venuesCreated > 0
            ? ` Added ${result.venuesCreated} new club${result.venuesCreated === 1 ? "" : "s"} from the Club app.`
            : "") +
          (result.unmapped > 0
            ? ` ${result.unmapped} row${result.unmapped === 1 ? "" : "s"} need a flavour mapping.`
            : ""),
      );
      router.refresh();
    } else {
      setSyncMessage(result.message);
    }
  }

  const syncFailed = data.lastSyncStatus === "failed";
  const notConfigured = !data.configured;

  const clubOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of data.rows) seen.set(r.clubId, r.clubName);
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.rows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Club Stock</h2>
          <p className="text-muted-foreground text-sm">
            Live stock from the Club app. Minimum requirements are used to
            identify low-stock clubs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="text-muted-foreground text-xs">
            Last synced: {fmtDateTime(data.lastSyncedAt)}
          </span>
          <Link
            href="/stock/club/mapping"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <Link2 className="size-4" /> Flavour mapping
          </Link>
          <Button variant="secondary" disabled={isSyncing} onClick={handleSync}>
            <RefreshCw className={cn(isSyncing && "animate-spin")} />
            {isSyncing ? "Syncing…" : "Sync Now"}
          </Button>
        </div>
      </div>

      {(notConfigured || syncFailed) && (
        <div
          className="border-warning/40 bg-warning/15 text-warning-foreground flex items-start gap-2 rounded-md border p-3 text-sm"
          role="status"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              {notConfigured
                ? "Club API is not configured"
                : "Unable to sync Club stock"}
            </p>
            <p className="mt-0.5">
              {notConfigured
                ? "Set CLUB_APP_BASE_URL and CLUB_APP_API_KEY to connect the Club app. Figures below are whatever was last stored."
                : (data.lastSyncError ?? "The Club app could not be reached.")}{" "}
              {data.rows.length > 0 && (
                <>
                  Showing last synced data from{" "}
                  {fmtDateTime(data.lastSyncedAt ?? data.rows[0]?.syncedAt)}.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {data.unmappedCount > 0 && (
        <div className="border-warning/40 bg-warning/15 text-warning-foreground flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <Link2 className="size-4 shrink-0" />
          <span className="flex-1">
            {data.unmappedCount} Club app flavour
            {data.unmappedCount === 1 ? "" : "s"}{" "}
            {data.unmappedCount === 1 ? "has" : "have"} no stored mapping. Any
            without a matching name are not shown below.
          </span>
          <Link
            href="/stock/club/mapping"
            className={buttonVariants({ size: "sm" })}
          >
            Map flavours
          </Link>
        </div>
      )}

      {syncMessage && <p className="text-sm">{syncMessage}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: Users, tone: "info", value: data.kpis.totalClubs, label: "Total Clubs" },
          { icon: TriangleAlert, tone: "warning", value: data.kpis.clubsLow, label: "Clubs Low Stock" },
          { icon: CircleOff, tone: "destructive", value: data.kpis.outOfStock, label: "Out of Stock" },
          { icon: Clock, tone: "primary", value: data.kpis.approaching, label: "Approaching Limit" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-card flex items-start gap-2.5 rounded-lg border p-3 sm:gap-3 sm:p-4"
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                TONE_CLASSES[kpi.tone],
              )}
            >
              <kpi.icon className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-qty text-base leading-tight sm:text-lg">
                {kpi.value}
              </p>
              <p className="text-muted-foreground mt-1 text-xs leading-snug">
                {kpi.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            aria-label="Search club or flavour"
            placeholder="Search club or flavour…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Club"
          value={clubId}
          onChange={(e) => setClubId(e.target.value)}
          className="border-input bg-card h-9 max-w-52 rounded-md border px-3 text-sm"
        >
          <option value="all">All Clubs</option>
          {clubOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border-input bg-card h-9 rounded-md border px-3 text-sm"
        >
          <option value="all">All Status</option>
          <option value="ok">OK</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
          <option value="approaching">Approaching Limit</option>
        </select>
        {!autoExpand && groups.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setExpanded(
                allOpen ? new Set() : new Set(groups.map((g) => g.clubId)),
              )
            }
          >
            <ChevronsUpDown /> {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={Martini}
          title="No club stock data available"
          description={
            notConfigured
              ? "Connect the Club app to pull live club stock into this screen."
              : "Nothing matches these filters, or the last sync returned no rows."
          }
        />
      ) : (
        <div className="grid gap-2">
          {groups.map((group) => (
            <ClubGroupCard
              key={group.clubId}
              group={group}
              open={isOpen(group.clubId)}
              // With a filter already narrowing things down there is
              // nothing to collapse to, so the chevron would be dead.
              collapsible={!autoExpand}
              onToggle={() => toggle(group.clubId)}
            />
          ))}
        </div>
      )}

      <div className="text-muted-foreground flex items-center gap-2 rounded-md border p-3 text-xs">
        <Info className="size-4 shrink-0" />
        Club stock is fetched from the Club app via API. It cannot be edited
        here.
      </div>
    </div>
  );
}

function CountChip({
  count,
  tone,
  label,
}: {
  count: number;
  tone: "destructive" | "warning" | "info" | "success";
  label: string;
}) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "destructive" &&
          "border-destructive/20 bg-destructive/10 text-destructive",
        tone === "warning" &&
          "border-warning/40 bg-warning/20 text-warning-foreground",
        tone === "info" && "border-info/20 bg-info/10 text-info",
        tone === "success" && "border-success/25 bg-success/15 text-success",
      )}
    >
      {count} {label}
    </span>
  );
}

function ClubGroupCard({
  group,
  open,
  collapsible,
  onToggle,
}: {
  group: ClubGroup;
  open: boolean;
  collapsible: boolean;
  onToggle: () => void;
}) {
  const header = (
    <>
      {collapsible && (
        <ChevronRight
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{group.clubName}</p>
        <p className="text-muted-foreground text-xs">
          {group.branchName || "—"} · {group.rows.length} flavour
          {group.rows.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <CountChip count={group.out} tone="destructive" label="out" />
        <CountChip count={group.low} tone="warning" label="low" />
        <CountChip count={group.approaching} tone="info" label="near min" />
        <CountChip count={group.ok} tone="success" label="ok" />
      </div>
    </>
  );

  return (
    <div className="bg-card rounded-lg border">
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="hover:bg-muted/30 flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors"
        >
          {header}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 p-3">{header}</div>
      )}

      {open && (
        <div className="border-t">
          {/* The club name is deliberately absent from these rows — it is
              the heading immediately above them. */}
          <table className="hidden w-full text-sm min-[700px]:table">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs [&>th]:whitespace-nowrap">
                <th className="px-4 py-2 font-medium">Flavour</th>
                <th className="px-4 py-2 text-right font-medium">Current</th>
                <th className="px-4 py-2 text-right font-medium">Minimum</th>
                <th className="px-4 py-2 text-right font-medium">Shortfall</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => {
                const shortfall =
                  row.minimumG == null
                    ? null
                    : Math.max(0, row.minimumG - row.currentG);
                return (
                  <tr
                    key={`${row.clubId}-${row.flavourName}`}
                    className="border-b last:border-0"
                  >
                    <td className="px-4 py-2">{row.flavourName}</td>
                    <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                      {formatGrams(row.currentG)}
                    </td>
                    <td className="font-qty text-muted-foreground px-4 py-2 text-right whitespace-nowrap">
                      {row.minimumG == null ? "—" : formatGrams(row.minimumG)}
                    </td>
                    <td
                      className={cn(
                        "font-qty px-4 py-2 text-right whitespace-nowrap",
                        shortfall
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {shortfall ? formatGrams(shortfall) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <StatusTag
                        status={
                          row.status === "out" ? "out_of_stock" : row.status
                        }
                        label={row.status === "ok" ? "OK" : undefined}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Narrow screens: a block per flavour, so nothing scrolls sideways. */}
          <div className="divide-y min-[700px]:hidden">
            {group.rows.map((row) => {
              const shortfall =
                row.minimumG == null
                  ? null
                  : Math.max(0, row.minimumG - row.currentG);
              return (
                <div
                  key={`${row.clubId}-${row.flavourName}`}
                  className="grid gap-1 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {row.flavourName}
                    </span>
                    <StatusTag
                      status={row.status === "out" ? "out_of_stock" : row.status}
                      label={row.status === "ok" ? "OK" : undefined}
                    />
                  </div>
                  <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                    <span>
                      Current{" "}
                      <span className="font-qty text-foreground">
                        {formatGrams(row.currentG)}
                      </span>
                    </span>
                    <span>
                      Minimum{" "}
                      <span className="font-qty">
                        {row.minimumG == null ? "—" : formatGrams(row.minimumG)}
                      </span>
                    </span>
                    {shortfall ? (
                      <span className="text-destructive">
                        Short by{" "}
                        <span className="font-qty">
                          {formatGrams(shortfall)}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
