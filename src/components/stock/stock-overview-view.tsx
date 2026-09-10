"use client";

import * as React from "react";
import Link from "next/link";
import {
  Boxes,
  Warehouse,
  Building2,
  Martini,
  TriangleAlert,
  CircleOff,
  FlaskConical,
  MapPin,
  ArrowRight,
  Search,
  ClipboardList,
  PartyPopper,
  ScanLine,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatGrams } from "@/lib/units";
import { StatusTag } from "@/components/shared/status-tag";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import type { OverviewData, StockRow } from "@/lib/stock/overview";

const TONE_CLASSES: Record<string, string> = {
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  primary: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
};

function Kpi({
  icon: Icon,
  tone,
  value,
  label,
  detail,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  value: string;
  label: string;
  detail?: string;
}) {
  return (
    <div className="bg-card flex items-start gap-3 rounded-lg border p-4">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          TONE_CLASSES[tone],
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="font-qty text-lg leading-none">{value}</p>
        <p className="text-muted-foreground mt-1 truncate text-xs">{label}</p>
        {detail && (
          <p className="text-muted-foreground/80 mt-0.5 truncate text-[11px]">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

const QUICK_ACTIONS: { icon: LucideIcon; label: string; href: string }[] = [
  { icon: ClipboardList, label: "Update Stock", href: "/stock/update" },
  { icon: PartyPopper, label: "Party Stock", href: "/stock/party" },
  { icon: ScanLine, label: "Count Stock", href: "/stock/count" },
  { icon: Martini, label: "Club Stock", href: "/stock/club" },
];

export function StockOverviewView({ data }: { data: OverviewData }) {
  const { kpis, rows, internalLocations, attention, activity, club } = data;

  const [locationId, setLocationId] = React.useState("all");
  const [itemType, setItemType] = React.useState<"flavour" | "raw" | "all">(
    // §8: mixed flavours are the primary operational view.
    "flavour",
  );
  const [search, setSearch] = React.useState("");

  // Showing every location as its own column stops being readable past a
  // handful, so past that the table narrows to one location at a time
  // (§9). The columns themselves are always derived, never hardcoded.
  const columnLocations = React.useMemo(
    () =>
      locationId === "all"
        ? internalLocations.slice(0, 4)
        : internalLocations.filter((l) => l.id === locationId),
    [internalLocations, locationId],
  );

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (itemType !== "all" && r.itemType !== itemType) return false;
      if (
        locationId !== "all" &&
        !(r.byLocation[locationId] > 0) &&
        r.clubStockG == null
      ) {
        return false;
      }
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) ||
        (r.code ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, itemType, locationId, search]);

  const totalFor = (row: StockRow) =>
    locationId === "all"
      ? row.totalInternalG
      : (row.byLocation[locationId] ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <Kpi
          icon={Boxes}
          tone="primary"
          value={formatGrams(kpis.totalInternalG)}
          label="Total Internal Stock"
          detail="Office + Godown"
        />
        <Kpi
          icon={Warehouse}
          tone="info"
          value={formatGrams(kpis.godownG)}
          label="Godown Stock"
        />
        <Kpi
          icon={Building2}
          tone="info"
          value={formatGrams(kpis.officeG)}
          label="Office Stock"
        />
        <Kpi
          icon={Martini}
          tone="success"
          value={formatGrams(kpis.clubG)}
          label="Club Stock"
          detail="from Club App"
        />
        <Kpi
          icon={TriangleAlert}
          tone="warning"
          value={String(kpis.lowStockCount)}
          label="Low Stock Items"
        />
        <Kpi
          icon={CircleOff}
          tone="destructive"
          value={String(kpis.outOfStockCount)}
          label="Out of Stock"
        />
        <Kpi
          icon={FlaskConical}
          tone="primary"
          value={String(kpis.flavourCount)}
          label="Total Flavours"
        />
        <Kpi
          icon={MapPin}
          tone="info"
          value={String(kpis.locationCount)}
          label="Locations"
        />
      </div>

      {attention.length > 0 && (
        <div className="bg-card rounded-lg border p-4">
          <p className="mb-3 text-sm font-medium">Stock needs attention</p>
          <div className="flex flex-wrap gap-2">
            {attention.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  item.tone === "destructive" &&
                    "border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15",
                  item.tone === "warning" &&
                    "border-warning/40 bg-warning/20 text-warning-foreground hover:bg-warning/25",
                  item.tone === "info" &&
                    "border-info/20 bg-info/10 text-info hover:bg-info/15",
                )}
              >
                {item.label}
                <ArrowRight className="size-3" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Location"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="border-input bg-card h-9 rounded-md border px-3 text-sm"
        >
          <option value="all">All Locations</option>
          {internalLocations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Item type"
          value={itemType}
          onChange={(e) =>
            setItemType(e.target.value as "flavour" | "raw" | "all")
          }
          className="border-input bg-card h-9 rounded-md border px-3 text-sm"
        >
          <option value="flavour">Mixed Flavours</option>
          <option value="raw">Raw Materials</option>
          <option value="all">All Items</option>
        </select>
        <div className="relative min-w-52 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            aria-label="Search flavour"
            placeholder="Search flavour…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No stock data available yet"
          description="Stock appears here once opening stock is set, goods are received, or a batch is mixed."
        />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-4 py-2.5 font-medium">Flavour</th>
                <th className="px-4 py-2.5 font-medium">Code</th>
                {columnLocations.map((l) => (
                  <th
                    key={l.id}
                    className="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                  >
                    {l.name}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-medium">
                  {locationId === "all" ? "Total Internal" : "Total"}
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Club Stock
                </th>
                <th className="px-4 py-2.5 font-medium">Club Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={`${row.itemType}|${row.itemId}`}
                  className="hover:bg-muted/30 border-b last:border-0"
                >
                  <td className="px-4 py-2.5 font-medium">{row.name}</td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    {row.code ?? "—"}
                  </td>
                  {columnLocations.map((l) => (
                    <td
                      key={l.id}
                      className="font-qty px-4 py-2.5 text-right whitespace-nowrap"
                    >
                      {formatGrams(row.byLocation[l.id] ?? 0)}
                    </td>
                  ))}
                  <td className="font-qty px-4 py-2.5 text-right font-medium whitespace-nowrap">
                    {formatGrams(totalFor(row))}
                  </td>
                  <td className="font-qty px-4 py-2.5 text-right whitespace-nowrap">
                    {row.clubStockG == null ? "—" : formatGrams(row.clubStockG)}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.clubStatus ? (
                      <StatusTag
                        status={
                          row.clubStatus === "out"
                            ? "out_of_stock"
                            : row.clubStatus
                        }
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        <div className="bg-card rounded-lg border p-4">
          <p className="mb-3 text-sm font-medium">Quick Actions</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="hover:bg-muted/40 flex items-center gap-2 rounded-md border p-2.5 text-xs font-medium transition-colors"
              >
                <action.icon className="text-primary size-4 shrink-0" />
                {action.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-lg border">
          <div className="border-b p-4">
            <p className="text-sm font-medium">Stock by Location</p>
          </div>
          {internalLocations.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              No locations configured yet.
            </p>
          ) : (
            <div className="divide-y">
              {internalLocations.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLocationId(l.id)}
                  className="hover:bg-muted/30 flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors"
                >
                  <span className="truncate">
                    {l.name}
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {l.branchName}
                    </span>
                  </span>
                  <span className="font-qty shrink-0">
                    {formatGrams(l.totalG)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-lg border">
          <div className="border-b p-4">
            <p className="text-sm font-medium">Recent Activity</p>
          </div>
          {activity.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              No stock movements yet.
            </p>
          ) : (
            <div className="divide-y">
              {activity.slice(0, 6).map((a) => (
                <div key={a.id} className="px-4 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{a.itemName}</span>
                    <span
                      className={cn(
                        "font-qty shrink-0",
                        a.qtyG < 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {a.qtyG > 0 ? "+" : ""}
                      {formatGrams(a.qtyG)}
                    </span>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {a.locationName} · {a.description} ·{" "}
                    {new Date(a.at).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!club.configured && (
        <p className="text-muted-foreground text-center text-xs">
          Club stock is read-only and fetched from the Club app. The Club API
          is not configured yet, so club figures show as last synced.
        </p>
      )}
    </div>
  );
}
