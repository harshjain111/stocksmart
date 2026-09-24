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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatGrams } from "@/lib/units";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusTag } from "@/components/shared/status-tag";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import type { ClubStockRowView } from "@/app/(app)/stock/club/actions";
import {
  triggerClubSync,
  type ClubStockData,
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

export function ClubStockView({ data }: { data: ClubStockData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = React.useState(params.get("status") ?? "all");
  const [search, setSearch] = React.useState("");
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!term) return true;
      return (
        r.clubName.toLowerCase().includes(term) ||
        r.flavourName.toLowerCase().includes(term)
      );
    });
  }, [data.rows, status, search]);

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

  const columns: DataTableColumn<ClubStockRowView>[] = [
    {
      key: "club",
      header: "Club",
      cardRole: "title",
      render: (row) => row.clubName,
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (row) => (
        <StatusTag
          status={row.status === "out" ? "out_of_stock" : row.status}
          label={row.status === "ok" ? "OK" : undefined}
        />
      ),
    },
    {
      key: "location",
      header: "Location",
      className: "text-muted-foreground",
      render: (row) => row.branchName || "—",
    },
    { key: "flavour", header: "Flavour", render: (row) => row.flavourName },
    {
      key: "current",
      header: "Current",
      numeric: true,
      className: "whitespace-nowrap",
      render: (row) => formatGrams(row.currentG),
    },
    {
      key: "minimum",
      header: "Minimum",
      numeric: true,
      className: "text-muted-foreground whitespace-nowrap",
      render: (row) =>
        row.minimumG == null ? "—" : formatGrams(row.minimumG),
    },
  ];

  const syncFailed = data.lastSyncStatus === "failed";
  const notConfigured = !data.configured;

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
        <div className="flex items-center gap-3">
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
          className={cn(
            "flex items-start gap-2 rounded-md border p-3 text-sm",
            "border-warning/40 bg-warning/15 text-warning-foreground",
          )}
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
                : data.lastSyncError ?? "The Club app could not be reached."}{" "}
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
      </div>

      {data.unmappedCount > 0 && (
        <div className="border-warning/40 bg-warning/15 text-warning-foreground flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <Link2 className="size-4 shrink-0" />
          <span className="flex-1">
            {data.unmappedCount} Club app flavour
            {data.unmappedCount === 1 ? "" : "s"} {data.unmappedCount === 1 ? "has" : "have"}{" "}
            no stored mapping. Any without a matching name are not shown below.
          </span>
          <Link href="/stock/club/mapping" className={buttonVariants({ size: "sm" })}>
            Map flavours
          </Link>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filtered}
        getRowKey={(row) => `${row.clubId}-${row.flavourName}`}
        emptyState={
          <EmptyState
            icon={Martini}
            title="No club stock data available"
            description={
              notConfigured
                ? "Connect the Club app to pull live club stock into this screen."
                : "Nothing matches this filter, or the last sync returned no rows."
            }
          />
        }
      />

      <div className="text-muted-foreground flex items-center gap-2 rounded-md border p-3 text-xs">
        <Info className="size-4 shrink-0" />
        Club stock is fetched from the Club app via API. It cannot be edited
        here.
      </div>
    </div>
  );
}
