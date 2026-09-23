"use client";

import * as React from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusTag } from "@/components/shared/status-tag";
import { EmptyState } from "@/components/shared/empty-state";
import {
  triggerClubSync,
  mapClubItem,
  type ClubStockData,
  type UnmappedItem,
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
          (result.unmapped > 0
            ? ` ${result.unmapped} row${result.unmapped === 1 ? "" : "s"} could not be matched — see Needs mapping below.`
            : ""),
      );
      router.refresh();
    } else {
      setSyncMessage(result.message);
    }
  }

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
          <div key={kpi.label} className="bg-card flex items-start gap-3 rounded-lg border p-4">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg",
                TONE_CLASSES[kpi.tone],
              )}
            >
              <kpi.icon className="size-5" />
            </span>
            <div>
              <p className="font-qty text-lg leading-none">{kpi.value}</p>
              <p className="text-muted-foreground mt-1 text-xs">{kpi.label}</p>
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

      {data.unmapped.length > 0 && (
        <UnmappedSection
          items={data.unmapped}
          clubs={data.mappableClubs}
          flavours={data.mappableFlavours}
          canMap={data.canMap}
          onMapped={() => router.refresh()}
        />
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Martini}
          title="No club stock data available"
          description={
            notConfigured
              ? "Connect the Club app to pull live club stock into this screen."
              : "Nothing matches this filter, or the last sync returned no rows."
          }
        />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-4 py-2.5 font-medium">Club</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Flavour</th>
                <th className="px-4 py-2.5 text-right font-medium">Current</th>
                <th className="px-4 py-2.5 text-right font-medium">Minimum</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={`${row.clubId}-${row.flavourName}`}
                  className="border-b last:border-0"
                >
                  <td className="px-4 py-2.5 font-medium">{row.clubName}</td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    {row.branchName}
                  </td>
                  <td className="px-4 py-2.5">{row.flavourName}</td>
                  <td className="font-qty px-4 py-2.5 text-right whitespace-nowrap">
                    {formatGrams(row.currentG)}
                  </td>
                  <td className="font-qty text-muted-foreground px-4 py-2.5 text-right whitespace-nowrap">
                    {row.minimumG == null ? "—" : formatGrams(row.minimumG)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusTag
                      status={row.status === "out" ? "out_of_stock" : row.status}
                      label={row.status === "ok" ? "OK" : undefined}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

/**
 * Rows the Club App sent that could not be placed. Without this they are
 * simply invisible — the stock never arrives and nothing says why. An
 * admin pairs each one with an inventory club or flavour, and the pairing
 * is remembered by the Club App's own id where it has one, so a later
 * rename on either side does not break it.
 */
function UnmappedSection({
  items,
  clubs,
  flavours,
  canMap,
  onMapped,
}: {
  items: UnmappedItem[];
  clubs: { id: string; name: string }[];
  flavours: { id: string; name: string }[];
  canMap: boolean;
  onMapped: () => void;
}) {
  const [choices, setChoices] = React.useState<
    Record<string, { clubId: string; flavourId: string }>
  >({});
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function save(item: UnmappedItem) {
    setError(null);
    setSavingKey(item.externalKey);
    const choice = choices[item.externalKey] ?? { clubId: "", flavourId: "" };
    const result = await mapClubItem({
      externalKey: item.externalKey,
      clubId: choice.clubId || null,
      flavourId: choice.flavourId || null,
    });
    setSavingKey(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onMapped();
  }

  return (
    <div className="bg-card rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <Link2 className="text-warning-foreground size-4 shrink-0" />
        <p className="text-sm font-medium">
          Needs mapping ({items.length})
        </p>
        <p className="text-muted-foreground text-xs">
          {canMap
            ? "These Club app rows don't match an inventory club or flavour yet. Pair them once and the link is remembered."
            : "These Club app rows don't match an inventory club or flavour yet. An admin needs to pair them."}
        </p>
      </div>

      {error && (
        <p className="text-destructive px-4 pt-3 text-sm" role="alert">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="px-4 py-2.5 font-medium">Club app venue</th>
              <th className="px-4 py-2.5 font-medium">Club app flavour</th>
              <th className="px-4 py-2.5 text-right font-medium">Stock</th>
              {canMap && <th className="px-4 py-2.5 font-medium">Map to</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const choice = choices[item.externalKey] ?? {
                clubId: "",
                flavourId: "",
              };
              const needsClub = item.missing !== "flavour";
              const needsFlavour = item.missing !== "club";
              return (
                <tr key={item.externalKey} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    {item.clubName}
                    {item.location && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {item.location}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{item.flavourName}</td>
                  <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                    {formatGrams(item.qtyG)}
                  </td>
                  {canMap && (
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {needsClub && (
                          <select
                            aria-label={`Inventory club for ${item.clubName}`}
                            value={choice.clubId}
                            onChange={(e) =>
                              setChoices((prev) => ({
                                ...prev,
                                [item.externalKey]: {
                                  ...choice,
                                  clubId: e.target.value,
                                },
                              }))
                            }
                            className="border-input bg-card h-8 rounded-md border px-2 text-xs"
                          >
                            <option value="">Select club…</option>
                            {clubs.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {needsFlavour && (
                          <select
                            aria-label={`Inventory flavour for ${item.flavourName}`}
                            value={choice.flavourId}
                            onChange={(e) =>
                              setChoices((prev) => ({
                                ...prev,
                                [item.externalKey]: {
                                  ...choice,
                                  flavourId: e.target.value,
                                },
                              }))
                            }
                            className="border-input bg-card h-8 rounded-md border px-2 text-xs"
                          >
                            <option value="">Select flavour…</option>
                            {flavours.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <Button
                          size="sm"
                          disabled={
                            savingKey === item.externalKey ||
                            (needsClub && !choice.clubId) ||
                            (needsFlavour && !choice.flavourId)
                          }
                          onClick={() => save(item)}
                        >
                          {savingKey === item.externalKey ? "Saving…" : "Map"}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground border-t px-4 py-2.5 text-xs">
        Mapped rows appear in the table above after the next sync.
      </p>
    </div>
  );
}
