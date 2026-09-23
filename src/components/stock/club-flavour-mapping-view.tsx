"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Link2,
  Link2Off,
  Plus,
  Search,
  Sparkles,
  CircleCheck,
} from "lucide-react";
import { formatGrams } from "@/lib/units";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import {
  setFlavourMapping,
  clearFlavourMapping,
  createAndMapFlavour,
  acceptAllSuggestions,
  type MappingData,
} from "@/app/(app)/stock/club/mapping/actions";

type Filter = "unmapped" | "mapped" | "all";

export function ClubFlavourMappingView({ data }: { data: MappingData }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>(
    data.unmappedCount > 0 ? "unmapped" : "all",
  );

  const [search, setSearch] = React.useState("");
  const [choices, setChoices] = React.useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const rows = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (filter === "unmapped" && r.mappedFlavourId) return false;
      if (filter === "mapped" && !r.mappedFlavourId) return false;
      if (!term) return true;
      return (
        r.clubAppName.toLowerCase().includes(term) ||
        (r.mappedFlavourName ?? "").toLowerCase().includes(term)
      );
    });
  }, [data.rows, filter, search]);

  async function run(
    key: string,
    fn: () => Promise<{ success: boolean; error?: string }>,
    successMessage?: string,
  ) {
    setError(null);
    setNotice(null);
    setBusyKey(key);
    const result = await fn();
    setBusyKey(null);
    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    if (successMessage) setNotice(successMessage);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Club Flavour Mapping</h2>
          <p className="text-muted-foreground text-sm">
            Pair each flavour the Club app reports with one of ours. Clubs
            themselves are created automatically — only flavours need a
            decision.
          </p>
        </div>
        <Link
          href="/stock/club"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> Back to Club Stock
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Stored mapping", value: data.mappedCount },
          { label: "Matching by name only", value: data.suggestionCount },
          {
            label: "No match — stock not shown",
            value: data.unmappedCount - data.suggestionCount,
          },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card rounded-lg border p-4">
            <p className="font-qty text-lg leading-none">{kpi.value}</p>
            <p className="text-muted-foreground mt-1 text-xs">{kpi.label}</p>
          </div>
        ))}
      </div>

      {!data.canMap && (
        <p className="text-muted-foreground border-warning/40 bg-warning/10 rounded-md border p-3 text-sm">
          Only an admin can change these mappings.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(["unmapped", "mapped", "all"] as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "secondary"}
              onClick={() => setFilter(f)}
            >
              {f === "unmapped"
                ? "Needs a mapping"
                : f === "mapped"
                  ? "Stored"
                  : "All"}
            </Button>
          ))}
        </div>
        <div className="relative min-w-52 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            aria-label="Search Club app flavour"
            placeholder="Search flavour…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {data.canMap && data.suggestionCount > 0 && (
          <Button
            variant="secondary"
            disabled={busyKey !== null}
            onClick={() =>
              run(
                "__all__",
                async () => {
                  const r = await acceptAllSuggestions();
                  return r.success
                    ? { success: true }
                    : { success: false, error: r.error };
                },
                `Accepted ${data.suggestionCount} name match${data.suggestionCount === 1 ? "" : "es"}.`,
              )
            }
          >
            <Sparkles /> Accept {data.suggestionCount} name match
            {data.suggestionCount === 1 ? "" : "es"}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="text-primary text-sm">{notice}</p>}

      {rows.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={
            data.rows.length === 0
              ? "Nothing from the Club app yet"
              : "Nothing matches this filter"
          }
          description={
            data.rows.length === 0
              ? "Run a sync on the Club Stock page — every flavour it reports will be listed here."
              : "Clear the search or switch filters to see the rest."
          }
        />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-4 py-2.5 font-medium">Club app flavour</th>
                <th className="px-4 py-2.5 text-right font-medium">Stock</th>
                <th className="px-4 py-2.5 text-right font-medium">Clubs</th>
                <th className="px-4 py-2.5 font-medium">Our flavour</th>
                {data.canMap && <th className="px-4 py-2.5 font-medium">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const chosen =
                  choices[row.externalKey] ??
                  row.mappedFlavourId ??
                  row.suggestedFlavourId ??
                  "";
                const busy = busyKey === row.externalKey;
                return (
                  <tr key={row.externalKey} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {row.clubAppName}
                      {!row.mappedFlavourId && row.suggestedFlavourName && (
                        <span className="text-info ml-2 text-xs">
                          syncing by name match to “
                          {row.suggestedFlavourName}”
                        </span>
                      )}
                      {!row.mappedFlavourId && !row.suggestedFlavourName && (
                        <span className="text-destructive ml-2 text-xs">
                          no match — its stock is not shown
                        </span>
                      )}
                    </td>
                    <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                      {formatGrams(row.lastQtyG)}
                    </td>
                    <td className="font-qty text-muted-foreground px-4 py-2 text-right">
                      {row.clubCount}
                    </td>
                    <td className="px-4 py-2">
                      {data.canMap ? (
                        <select
                          aria-label={`Our flavour for ${row.clubAppName}`}
                          value={chosen}
                          onChange={(e) =>
                            setChoices((prev) => ({
                              ...prev,
                              [row.externalKey]: e.target.value,
                            }))
                          }
                          className="border-input bg-card h-8 min-w-48 rounded-md border px-2 text-xs"
                        >
                          <option value="">Not mapped</option>
                          {data.flavours.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      ) : row.mappedFlavourName ? (
                        <span className="flex items-center gap-1.5">
                          <CircleCheck className="text-success size-4" />
                          {row.mappedFlavourName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not mapped</span>
                      )}
                    </td>
                    {data.canMap && (
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="sm"
                            disabled={
                              busy || !chosen || chosen === row.mappedFlavourId
                            }
                            onClick={() =>
                              run(row.externalKey, () =>
                                setFlavourMapping({
                                  externalKey: row.externalKey,
                                  flavourId: chosen,
                                }),
                              )
                            }
                          >
                            {busy ? "Saving…" : "Save"}
                          </Button>
                          {row.mappedFlavourId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Unmap ${row.clubAppName}`}
                              disabled={busy}
                              onClick={() =>
                                run(row.externalKey, () =>
                                  clearFlavourMapping(row.externalKey),
                                )
                              }
                            >
                              <Link2Off className="size-4" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              title="Create this as a new flavour and map to it"
                              onClick={() =>
                                run(
                                  row.externalKey,
                                  async () => {
                                    const r = await createAndMapFlavour(
                                      row.externalKey,
                                    );
                                    return r.success
                                      ? { success: true }
                                      : { success: false, error: r.error };
                                  },
                                  `Created “${row.clubAppName}” and mapped it.`,
                                )
                              }
                            >
                              <Plus className="size-4" /> Create
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        A flavour whose name matches ours already syncs, but only for as
        long as both names stay identical. Saving a mapping stores the
        pairing against the Club app&apos;s own id where it has one, so a
        rename on either side cannot break it. New mappings take effect on
        the next sync.
      </p>
    </div>
  );
}
