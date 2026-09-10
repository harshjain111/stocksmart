"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, RotateCcw, CalendarDays, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatGrams, kgToGrams } from "@/lib/units";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/empty-state";
import {
  getUpdateStockData,
  submitDailyClose,
  type UpdateStockItem,
} from "@/app/(app)/stock/update/actions";

type Location = {
  id: string;
  name: string;
  branchName: string;
  holdsRaw: boolean;
  holdsMixed: boolean;
};

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function UpdateStockView({
  locations,
  defaultLocationId,
}: {
  locations: Location[];
  defaultLocationId: string | null;
}) {
  const router = useRouter();
  const [locationId, setLocationId] = React.useState(
    defaultLocationId ?? locations[0]?.id ?? "",
  );
  const [countDate, setCountDate] = React.useState(todayIso());
  const [itemType, setItemType] = React.useState<"raw" | "flavour">("flavour");
  const [search, setSearch] = React.useState("");
  const [items, setItems] = React.useState<UpdateStockItem[]>([]);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [alreadyClosed, setAlreadyClosed] = React.useState(false);
  const [closedCountNo, setClosedCountNo] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  const load = React.useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    setError(null);
    setSaved(null);
    const result = await getUpdateStockData(locationId, countDate, itemType);
    setIsLoading(false);
    if (!result.success) {
      setError(result.error);
      setItems([]);
      return;
    }
    setItems(result.data.items);
    setAlreadyClosed(result.data.alreadyClosed);
    setClosedCountNo(result.data.closedCountNo);
    setValues({});
    setNotes({});
  }, [locationId, countDate, itemType]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(term) ||
        (i.code ?? "").toLowerCase().includes(term),
    );
  }, [items, search]);

  // Enter and the arrow keys walk down the column, so a whole location can
  // be entered without touching the mouse (§12).
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = e.key === "ArrowUp" ? index - 1 : index + 1;
    inputRefs.current[next]?.focus();
    inputRefs.current[next]?.select();
  }

  function differenceG(item: UpdateStockItem): number | null {
    const raw = values[item.itemId];
    if (raw === undefined || raw.trim() === "") return null;
    const kg = Number(raw);
    if (!Number.isFinite(kg)) return null;
    return kgToGrams(kg) - item.previousQtyG;
  }

  const enteredCount = Object.values(values).filter(
    (v) => v.trim() !== "" && Number.isFinite(Number(v)),
  ).length;

  async function handleSave() {
    setError(null);
    const lines = items
      .filter((i) => {
        const raw = values[i.itemId];
        return raw !== undefined && raw.trim() !== "" && Number.isFinite(Number(raw));
      })
      .map((i) => ({
        itemType: i.itemType,
        itemId: i.itemId,
        countedQtyG: kgToGrams(Number(values[i.itemId])),
        note: notes[i.itemId]?.trim() || undefined,
      }));

    if (lines.length === 0) {
      setError("Enter a closing quantity for at least one item.");
      return;
    }
    if (lines.some((l) => l.countedQtyG < 0)) {
      setError("Closing stock cannot be negative.");
      return;
    }

    setIsSaving(true);
    const result = await submitDailyClose({ departmentId: locationId, countDate, lines });
    setIsSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSaved(`Saved ${lines.length} item${lines.length === 1 ? "" : "s"}.`);
    router.refresh();
    void load();
  }

  const location = locations.find((l) => l.id === locationId);

  if (locations.length === 0) {
    return (
      <EmptyState
        icon={Lock}
        title="No locations you can update"
        description="You are not assigned to any location that holds stock. Ask an admin to assign you one."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Daily Stock Update</h2>
        <p className="text-muted-foreground text-sm">
          Enter closing stock for the selected location. The difference is
          calculated automatically.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="count-date">Date</Label>
          <div className="relative">
            <CalendarDays className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              id="count-date"
              type="date"
              max={todayIso()}
              className="w-48 pl-8"
              value={countDate}
              onChange={(e) => setCountDate(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="location">Location</Label>
          <select
            id="location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="border-input bg-card h-9 min-w-56 rounded-md border px-3 text-sm"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.branchName ? ` · ${l.branchName}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={itemType === "flavour" ? "default" : "secondary"}
            onClick={() => setItemType("flavour")}
            disabled={location ? !location.holdsMixed : false}
          >
            Mixed flavours
          </Button>
          <Button
            type="button"
            size="sm"
            variant={itemType === "raw" ? "default" : "secondary"}
            onClick={() => setItemType("raw")}
            disabled={location ? !location.holdsRaw : false}
          >
            Raw materials
          </Button>
        </div>
        <div className="relative ml-auto min-w-52">
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

      {alreadyClosed && (
        <div className="border-warning/40 bg-warning/15 text-warning-foreground flex items-center gap-2 rounded-md border p-3 text-sm">
          <Lock className="size-4 shrink-0" />
          Stock for this location was already closed on this date
          {closedCountNo ? ` (${closedCountNo})` : ""}. Pick another date, or
          use Count &amp; Variance to correct it.
        </div>
      )}

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="text-primary text-sm">{saved}</p>}

      {isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-muted h-11 animate-pulse rounded-md" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No stock items configured for this location"
          description="Add flavours or raw materials in Setup, or clear the search to see everything."
        />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-4 py-2.5 font-medium">Flavour</th>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Previous Day (kg)
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Closing Stock (kg)
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Difference
                </th>
                <th className="px-4 py-2.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => {
                const diff = differenceG(item);
                return (
                  <tr key={item.itemId} className="border-b last:border-0">
                    <td className="px-4 py-1.5 font-medium">{item.name}</td>
                    <td className="text-muted-foreground px-4 py-1.5">
                      {item.code ?? "—"}
                    </td>
                    <td className="font-qty px-4 py-1.5 text-right whitespace-nowrap">
                      {(item.previousQtyG / 1000).toFixed(1)}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <Input
                        ref={(el) => {
                          inputRefs.current[index] = el;
                        }}
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        // The first box is focused on load so entry can
                        // start immediately (§12).
                        autoFocus={index === 0}
                        disabled={alreadyClosed}
                        aria-label={`Closing stock for ${item.name} in kg`}
                        className="font-qty ml-auto w-24 text-right"
                        value={values[item.itemId] ?? ""}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [item.itemId]: e.target.value,
                          }))
                        }
                      />
                    </td>
                    <td
                      className={cn(
                        "font-qty px-4 py-1.5 text-right whitespace-nowrap",
                        diff == null && "text-muted-foreground",
                        diff != null && diff < 0 && "text-destructive",
                        diff != null && diff > 0 && "text-success",
                      )}
                    >
                      {diff == null
                        ? "—"
                        : `${diff > 0 ? "+" : ""}${formatGrams(diff)}`}
                    </td>
                    <td className="px-4 py-1.5">
                      <Input
                        disabled={alreadyClosed}
                        aria-label={`Note for ${item.name}`}
                        placeholder="Optional"
                        className="min-w-40"
                        value={notes[item.itemId] ?? ""}
                        onChange={(e) =>
                          setNotes((prev) => ({
                            ...prev,
                            [item.itemId]: e.target.value,
                          }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={isSaving || enteredCount === 0}
          onClick={() => {
            setValues({});
            setNotes({});
            setError(null);
          }}
        >
          <RotateCcw /> Reset
        </Button>
        <span className="text-muted-foreground text-xs">
          {enteredCount} item{enteredCount === 1 ? "" : "s"} entered
        </span>
        <Button
          type="button"
          className="ml-auto"
          disabled={isSaving || alreadyClosed || enteredCount === 0}
          onClick={handleSave}
        >
          {isSaving ? "Saving…" : "Save Stock"}
        </Button>
      </div>
    </div>
  );
}
