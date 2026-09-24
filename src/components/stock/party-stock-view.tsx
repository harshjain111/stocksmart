"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, PartyPopper, Trash2, Search, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatGrams, kgToGrams } from "@/lib/units";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusTag } from "@/components/shared/status-tag";
import { EmptyState } from "@/components/shared/empty-state";
import {
  createPartyEntry,
  getAvailableItems,
  recordPartyReturn,
  type AvailableItem,
  type PartyLocation,
  type PartyView,
} from "@/app/(app)/stock/party/actions";

function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type DraftLine = { itemId: string; name: string; availableG: number; qtyKg: string };

export function PartyStockView({
  parties,
  locations,
  defaultLocationId,
  /** The gate man gets the party list and nothing else around it (§25). */
  minimal = false,
}: {
  parties: PartyView[];
  locations: PartyLocation[];
  defaultLocationId: string | null;
  minimal?: boolean;
}) {
  const router = useRouter();
  const [showNew, setShowNew] = React.useState(false);
  const [openPartyId, setOpenPartyId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return parties;
    return parties.filter(
      (p) =>
        p.partyName.toLowerCase().includes(term) ||
        p.partyNo.toLowerCase().includes(term),
    );
  }, [parties, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Party Stock Movement</h2>
          <p className="text-muted-foreground text-sm">
            Record flavours taken out for parties and returns. Consumption is
            calculated automatically.
          </p>
        </div>
        {locations.length > 0 && (
          <Button onClick={() => setShowNew((v) => !v)}>
            <Plus /> Add Party Entry
          </Button>
        )}
      </div>

      {showNew && (
        <NewPartyForm
          locations={locations}
          defaultLocationId={defaultLocationId}
          onDone={() => {
            setShowNew(false);
            router.refresh();
          }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {!minimal && parties.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            aria-label="Search party name"
            placeholder="Search party name…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="No party movements yet"
          description="Use Add Party Entry to record flavours going out to an event."
        />
      ) : (
        <div className="grid gap-2">
          {filtered.map((party) => (
            <PartyCard
              key={party.id}
              party={party}
              expanded={openPartyId === party.id}
              onToggle={() =>
                setOpenPartyId(openPartyId === party.id ? null : party.id)
              }
              onSaved={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PartyCard({
  party,
  expanded,
  onToggle,
  onSaved,
}: {
  party: PartyView;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [returns, setReturns] = React.useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!expanded) return;
    setReturns(
      Object.fromEntries(
        party.lines.map((l) => [l.id, (l.returnedG / 1000).toString()]),
      ),
    );
    setError(null);
  }, [expanded, party.lines]);

  const isClosed = party.status === "completed" || party.status === "cancelled";
  const totalTaken = party.lines.reduce((s, l) => s + l.takenG, 0);
  const totalConsumed = party.lines.reduce((s, l) => s + l.consumedG, 0);

  async function handleSave(close: boolean) {
    setError(null);
    const lines = party.lines.map((l) => {
      const raw = returns[l.id];
      const kg = raw === undefined || raw.trim() === "" ? 0 : Number(raw);
      return { lineId: l.id, returnedQtyG: kgToGrams(kg) };
    });
    if (lines.some((l) => !Number.isFinite(l.returnedQtyG) || l.returnedQtyG < 0)) {
      setError("Returned quantity cannot be negative.");
      return;
    }
    const over = party.lines.find((l, i) => lines[i].returnedQtyG > l.takenG);
    if (over) {
      setError(`Cannot return more ${over.name} than went out.`);
      return;
    }

    setIsSaving(true);
    const result = await recordPartyReturn({ partyId: party.id, lines, close });
    setIsSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="bg-card rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-muted/30 flex w-full flex-wrap items-center gap-3 p-3 text-left transition-colors"
      >
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">{party.partyName}</p>
          <p className="text-muted-foreground text-xs">
            {party.partyNo} · {party.locationName} · {fmtDate(party.eventDate)}
          </p>
        </div>
        <div className="text-muted-foreground hidden text-xs sm:block">
          {party.lines.length} flavour{party.lines.length === 1 ? "" : "s"} ·{" "}
          <span className="font-qty">{formatGrams(totalTaken)}</span> out
        </div>
        {party.returnPending && <StatusTag status="pending" label="Return pending" />}
        <StatusTag status={party.status} />
      </button>

      {expanded && (
        <div className="border-t p-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs [&>th]:whitespace-nowrap">
                  <th className="py-1.5 pr-3 font-medium">Flavour</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Taken</th>
                  <th className="py-1.5 pr-3 text-right font-medium">
                    Returned (kg)
                  </th>
                  <th className="py-1.5 text-right font-medium">Consumed</th>
                </tr>
              </thead>
              <tbody>
                {party.lines.map((line) => {
                  const raw = returns[line.id];
                  const returnedG =
                    raw === undefined || raw.trim() === ""
                      ? 0
                      : kgToGrams(Number(raw));
                  const consumedG = Number.isFinite(returnedG)
                    ? line.takenG - returnedG
                    : line.consumedG;
                  return (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{line.name}</td>
                      <td className="font-qty py-1.5 pr-3 text-right whitespace-nowrap">
                        {formatGrams(line.takenG)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {isClosed ? (
                          <span className="font-qty">
                            {formatGrams(line.returnedG)}
                          </span>
                        ) : (
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0"
                            max={line.takenG / 1000}
                            aria-label={`Returned ${line.name} in kg`}
                            className="font-qty ml-auto w-24 text-right"
                            value={returns[line.id] ?? ""}
                            onChange={(e) =>
                              setReturns((prev) => ({
                                ...prev,
                                [line.id]: e.target.value,
                              }))
                            }
                          />
                        )}
                      </td>
                      <td
                        className={cn(
                          "font-qty py-1.5 text-right whitespace-nowrap",
                          consumedG > 0 && "text-destructive",
                        )}
                      >
                        {formatGrams(Math.max(0, consumedG))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && (
            <p className="text-destructive mt-2 text-sm" role="alert">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">
              Consumed so far:{" "}
              <span className="font-qty">{formatGrams(totalConsumed)}</span>
            </span>
            {!isClosed && (
              <>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={isSaving}
                  onClick={() => handleSave(false)}
                >
                  {isSaving ? "Saving…" : "Save Return"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isSaving}
                  onClick={() => handleSave(true)}
                >
                  Save &amp; Close Party
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NewPartyForm({
  locations,
  defaultLocationId,
  onDone,
  onCancel,
}: {
  locations: PartyLocation[];
  defaultLocationId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [departmentId, setDepartmentId] = React.useState(
    defaultLocationId ?? locations[0]?.id ?? "",
  );
  const [partyName, setPartyName] = React.useState("");
  const [eventDate, setEventDate] = React.useState(todayIso());
  const [expectedReturn, setExpectedReturn] = React.useState("");
  const [available, setAvailable] = React.useState<AvailableItem[]>([]);
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [picked, setPicked] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!departmentId) return;
    let cancelled = false;
    void getAvailableItems(departmentId).then((result) => {
      if (cancelled) return;
      if (result.success) setAvailable(result.data);
      else setError(result.error);
    });
    setLines([]);
    return () => {
      cancelled = true;
    };
  }, [departmentId]);

  const unused = available.filter((a) => !lines.some((l) => l.itemId === a.itemId));

  function addLine() {
    const item = available.find((a) => a.itemId === picked);
    if (!item) return;
    setLines((prev) => [
      ...prev,
      { itemId: item.itemId, name: item.name, availableG: item.availableG, qtyKg: "" },
    ]);
    setPicked("");
  }

  async function handleSave() {
    setError(null);
    const payload = lines
      .filter((l) => l.qtyKg.trim() !== "" && Number.isFinite(Number(l.qtyKg)))
      .map((l) => ({
        itemType: "flavour" as const,
        itemId: l.itemId,
        qtyG: kgToGrams(Number(l.qtyKg)),
      }));

    if (!partyName.trim()) {
      setError("Party name is required.");
      return;
    }
    if (payload.length === 0) {
      setError("Add at least one flavour with a quantity.");
      return;
    }
    if (payload.some((l) => l.qtyG <= 0)) {
      setError("Quantity must be more than zero.");
      return;
    }
    const tooMuch = lines.find(
      (l) => l.qtyKg.trim() !== "" && kgToGrams(Number(l.qtyKg)) > l.availableG,
    );
    if (tooMuch) {
      setError(
        `Only ${formatGrams(tooMuch.availableG)} of ${tooMuch.name} is available.`,
      );
      return;
    }

    setIsSaving(true);
    const result = await createPartyEntry({
      departmentId,
      partyName,
      eventDate,
      expectedReturnDate: expectedReturn === "" ? null : expectedReturn,
      lines: payload,
    });
    setIsSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <div className="bg-card grid gap-3 rounded-lg border p-4">
      <p className="text-sm font-medium">New party entry</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="party-name">Party name</Label>
          <Input
            id="party-name"
            autoFocus
            className="min-w-56"
            placeholder="e.g. Rahul Wedding"
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="party-location">Location</Label>
          <select
            id="party-location"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="border-input bg-card h-9 min-w-48 rounded-md border px-3 text-sm"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="party-date">Date</Label>
          <div className="relative">
            <CalendarDays className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              id="party-date"
              type="date"
              className="w-44 pl-8"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="party-return">Expected return</Label>
          <Input
            id="party-return"
            type="date"
            className="w-44"
            value={expectedReturn}
            onChange={(e) => setExpectedReturn(e.target.value)}
          />
        </div>
      </div>

      {lines.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40">
              <tr className="text-muted-foreground border-b text-left text-xs [&>th]:whitespace-nowrap">
                <th className="px-3 py-2 font-medium">Flavour</th>
                <th className="px-3 py-2 text-right font-medium">Available</th>
                <th className="px-3 py-2 text-right font-medium">Taking (kg)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.itemId} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{line.name}</td>
                  <td className="font-qty text-muted-foreground px-3 py-1.5 text-right whitespace-nowrap">
                    {formatGrams(line.availableG)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      aria-label={`Quantity of ${line.name} in kg`}
                      className="font-qty ml-auto w-24 text-right"
                      value={line.qtyKg}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, idx) =>
                            idx === i ? { ...l, qtyKg: e.target.value } : l,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${line.name}`}
                      onClick={() =>
                        setLines((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      <Trash2 className="text-destructive size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="party-flavour">Flavour</Label>
          <select
            id="party-flavour"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="border-input bg-card h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Select a flavour…</option>
            {unused.map((a) => (
              <option key={a.itemId} value={a.itemId}>
                {a.name} ({formatGrams(a.availableG)} available)
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" disabled={!picked} onClick={addLine}>
          <Plus /> Add Flavour
        </Button>
      </div>

      {available.length === 0 && (
        <p className="text-muted-foreground text-sm">
          This location has no flavour stock to send out.
        </p>
      )}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button disabled={isSaving} onClick={handleSave}>
          {isSaving ? "Saving…" : "Save Party Entry"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
