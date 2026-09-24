"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  TriangleAlert,
  PackageOpen,
  Check,
  ArrowRight,
  ArrowLeft,
  Search,
  CircleCheck,
} from "lucide-react";
import {
  getDepartmentOpeningData,
  submitOpeningStock,
} from "@/app/(app)/stock/opening/actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatGrams, kgToGrams } from "@/lib/units";
import { cn } from "@/lib/utils";

type Department = {
  id: string;
  name: string;
  branchName: string;
  holdsRaw: boolean;
  holdsMixed: boolean;
};
type Item = { id: string; code: string | null; name: string };
type Row = { itemType: "raw" | "flavour"; item: Item };

const STEPS = ["Enter Stock", "Review", "Submit"] as const;
type Step = 0 | 1 | 2;

function Stepper({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  done && "bg-primary text-primary-foreground",
                  active && "bg-primary text-primary-foreground",
                  !done && !active && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-sm whitespace-nowrap",
                  active ? "text-foreground font-medium" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  "h-px min-w-6 flex-1",
                  i < current ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function OpeningStockView({
  departments,
  rawMaterials,
  flavours,
  isAdmin,
}: {
  departments: Department[];
  rawMaterials: Item[];
  flavours: Item[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [departmentId, setDepartmentId] = React.useState(
    departments[0]?.id ?? "",
  );
  const [step, setStep] = React.useState<Step>(0);
  const [itemType, setItemType] = React.useState<"raw" | "flavour">("raw");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [isLocked, setIsLocked] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [balanceByKey, setBalanceByKey] = React.useState<Map<string, number>>(
    new Map(),
  );
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [postedCount, setPostedCount] = React.useState(0);

  const department = departments.find((d) => d.id === departmentId);

  const load = React.useCallback(async (id: string) => {
    setLoading(true);
    setReopening(false);
    setServerError(null);
    setStep(0);
    const result = await getDepartmentOpeningData(id);
    setLoading(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setIsLocked(result.data.isLocked);
    setBalanceByKey(
      new Map(
        result.data.balances.map((b) => [`${b.itemType}|${b.itemId}`, b.qtyG]),
      ),
    );
    setValues({});
  }, []);

  React.useEffect(() => {
    if (departmentId) void load(departmentId);
  }, [departmentId, load]);

  // Default to whichever kind of stock this location actually holds, so a
  // flavour-only office doesn't open on an empty Raw materials tab.
  React.useEffect(() => {
    if (!department) return;
    setItemType(department.holdsRaw ? "raw" : "flavour");
  }, [department]);

  const allRows: Row[] = React.useMemo(
    () => [
      ...(department?.holdsRaw
        ? rawMaterials.map((item) => ({ itemType: "raw" as const, item }))
        : []),
      ...(department?.holdsMixed
        ? flavours.map((item) => ({ itemType: "flavour" as const, item }))
        : []),
    ],
    [department, rawMaterials, flavours],
  );

  const visibleRows = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (r.itemType !== itemType) return false;
      if (!term) return true;
      return (
        r.item.name.toLowerCase().includes(term) ||
        (r.item.code ?? "").toLowerCase().includes(term)
      );
    });
  }, [allRows, itemType, search]);

  /** Only rows the user actually filled in — a blank box is "not counted", not zero. */
  const entered = React.useMemo(
    () =>
      allRows
        .map((r) => {
          const key = `${r.itemType}|${r.item.id}`;
          const raw = values[key];
          if (raw === undefined || raw.trim() === "") return null;
          const kg = Number(raw);
          if (!Number.isFinite(kg) || kg < 0) return null;
          return { row: r, key, qtyG: kgToGrams(kg) };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null),
    [allRows, values],
  );

  const hasInvalid = Object.entries(values).some(([, raw]) => {
    if (raw.trim() === "") return false;
    const n = Number(raw);
    return !Number.isFinite(n) || n < 0;
  });

  async function handleSubmit() {
    if (!department) return;
    setServerError(null);
    setIsSubmitting(true);
    const result = await submitOpeningStock({
      departmentId: department.id,
      entries: entered.map((e) => ({
        itemType: e.row.itemType,
        itemId: e.row.item.id,
        desiredQtyG: e.qtyG,
      })),
      reopen: reopening,
    });
    setIsSubmitting(false);
    if (!result.success) {
      setServerError(result.error);
      setStep(1);
      return;
    }
    setPostedCount(result.data.postedCount);
    setStep(2);
    router.refresh();
  }

  if (departments.length === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title="No locations yet"
        description="Add departments under Setup › Branches & departments first."
      />
    );
  }

  const locationPicker = (
    <div className="grid gap-1.5">
      <Label>Location</Label>
      <Select
        items={departments.map((d) => ({
          value: d.id,
          label: `${d.name} (${d.branchName})`,
        }))}
        value={departmentId}
        onValueChange={(v) => v && setDepartmentId(v)}
      >
        <SelectTrigger className="w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {departments.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name} ({d.branchName})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">Opening Stock</h2>
        <p className="text-muted-foreground text-sm">
          Set initial stock for a location. This is a one-time process.
        </p>
      </div>

      {/* §34: the one-way nature of this screen is stated before anyone
          types into it, not discovered afterwards. */}
      <div className="border-warning/40 bg-warning/15 text-warning-foreground flex items-start gap-2 rounded-md border p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Opening stock is a one-time setup for new locations. Once submitted
          it cannot be edited. If corrections are required, use a stock count
          adjustment instead.
        </span>
      </div>

      <Stepper current={step} />

      {loading ? (
        <div className="grid gap-2">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : isLocked && !reopening ? (
        <div className="grid gap-4">
          {locationPicker}
          <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-lg border p-3 text-sm">
            <Lock className="text-warning-foreground mt-0.5 size-4 shrink-0" />
            <p>
              Opening stock has already been submitted for this location.
              {isAdmin
                ? " As admin you can reopen it to post a correction; the change is logged."
                : " Only an admin can reopen it."}
            </p>
          </div>
          <div className="bg-card overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40">
                <tr className="text-muted-foreground border-b text-left text-xs [&>th]:whitespace-nowrap">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Current stock
                  </th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((r) => {
                  const key = `${r.itemType}|${r.item.id}`;
                  return (
                    <tr key={key} className="border-b last:border-0">
                      <td className="px-4 py-2">{r.item.name}</td>
                      <td className="text-muted-foreground px-4 py-2">
                        {r.item.code ?? "—"}
                      </td>
                      <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                        {formatGrams(balanceByKey.get(key) ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {isAdmin && (
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={() => setReopening(true)}
            >
              Reopen to correct
            </Button>
          )}
        </div>
      ) : allRows.length === 0 ? (
        <div className="grid gap-4">
          {locationPicker}
          <EmptyState
            icon={PackageOpen}
            title="Nothing to open"
            description={
              !department?.holdsRaw && !department?.holdsMixed
                ? "This location doesn't hold raw materials or mixed flavours."
                : "No active raw materials or flavours exist yet — add some under Setup › Materials & flavours."
            }
          />
        </div>
      ) : step === 0 ? (
        /* ------------------------------------------------ 1. Enter Stock */
        <div className="grid gap-4">
          {reopening && (
            <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-lg border p-3 text-sm">
              <Lock className="text-warning-foreground mt-0.5 size-4 shrink-0" />
              <p>
                Reopened for correction — entering a value posts the difference
                from current stock, not a replacement. This is logged.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            {locationPicker}
            <div className="flex gap-1 pb-0.5">
              <Button
                type="button"
                size="sm"
                variant={itemType === "raw" ? "default" : "secondary"}
                disabled={!department?.holdsRaw}
                onClick={() => setItemType("raw")}
              >
                Raw materials
              </Button>
              <Button
                type="button"
                size="sm"
                variant={itemType === "flavour" ? "default" : "secondary"}
                disabled={!department?.holdsMixed}
                onClick={() => setItemType("flavour")}
              >
                Mixed flavours
              </Button>
            </div>
            <div className="relative ml-auto min-w-52">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                aria-label="Search item"
                placeholder="Search item…"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {visibleRows.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Nothing matches that search"
              description="Clear the search to see every item for this location."
            />
          ) : (
            <div className="bg-card overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-muted-foreground border-b text-left text-xs [&>th]:whitespace-nowrap">
                    <th className="px-4 py-2.5 font-medium">
                      {itemType === "raw" ? "Raw material" : "Flavour"}
                    </th>
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    {reopening && (
                      <th className="px-4 py-2.5 text-right font-medium">
                        Current stock
                      </th>
                    )}
                    <th className="px-4 py-2.5 font-medium">Unit</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Opening Quantity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r, index) => {
                    const key = `${r.itemType}|${r.item.id}`;
                    return (
                      <tr key={key} className="border-b last:border-0">
                        <td className="px-4 py-1.5">{r.item.name}</td>
                        <td className="text-muted-foreground px-4 py-1.5">
                          {r.item.code ?? "—"}
                        </td>
                        {reopening && (
                          <td className="font-qty px-4 py-1.5 text-right whitespace-nowrap">
                            {formatGrams(balanceByKey.get(key) ?? 0)}
                          </td>
                        )}
                        <td className="text-muted-foreground px-4 py-1.5">
                          kg
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0"
                            autoFocus={index === 0}
                            aria-label={`Opening quantity for ${r.item.name} in kg`}
                            className="font-qty ml-auto w-28 text-right"
                            placeholder="0"
                            value={values[key] ?? ""}
                            onChange={(e) =>
                              setValues((prev) => ({
                                ...prev,
                                [key]: e.target.value,
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

          {hasInvalid && (
            <p className="text-destructive text-sm" role="alert">
              Opening quantities must be zero or more.
            </p>
          )}
          {serverError && (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {entered.length} item{entered.length === 1 ? "" : "s"} entered
              {department?.holdsRaw && department?.holdsMixed
                ? " across both tabs"
                : ""}
            </span>
            <Button
              variant="secondary"
              className="ml-auto"
              onClick={() => {
                setValues({});
                setSearch("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={entered.length === 0 || hasInvalid}
              onClick={() => setStep(1)}
            >
              Review &amp; Continue <ArrowRight />
            </Button>
          </div>
        </div>
      ) : step === 1 ? (
        /* ---------------------------------------------------- 2. Review */
        <div className="grid gap-4">
          <div className="bg-card rounded-lg border p-4">
            <p className="text-sm font-medium">
              {department?.name}
              {department?.branchName ? ` · ${department.branchName}` : ""}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {entered.length} item{entered.length === 1 ? "" : "s"} will be
              opened, totalling{" "}
              <span className="font-qty">
                {formatGrams(entered.reduce((s, e) => s + e.qtyG, 0))}
              </span>
              .
            </p>
          </div>

          {/* Submitting locks the whole location, not just the rows filled
              in — so anything still blank can only be corrected later
              through a count adjustment. Worth saying plainly while there
              is still a Back button. */}
          {allRows.length > entered.length && (
            <div className="border-warning/40 bg-warning/15 text-warning-foreground flex items-start gap-2 rounded-md border p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {allRows.length - entered.length} of {allRows.length} items
                have no quantity and will be left at zero. Submitting locks
                this location for every item, so go back now if any of them
                still need an opening figure.
              </span>
            </div>
          )}

          <div className="bg-card overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40">
                <tr className="text-muted-foreground border-b text-left text-xs [&>th]:whitespace-nowrap">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  {reopening && (
                    <th className="px-4 py-2.5 text-right font-medium">
                      Current stock
                    </th>
                  )}
                  <th className="px-4 py-2.5 text-right font-medium">
                    Opening Quantity
                  </th>
                </tr>
              </thead>
              <tbody>
                {entered.map((e) => (
                  <tr key={e.key} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{e.row.item.name}</td>
                    <td className="text-muted-foreground px-4 py-2">
                      {e.row.item.code ?? "—"}
                    </td>
                    <td className="text-muted-foreground px-4 py-2">
                      {e.row.itemType === "raw" ? "Raw material" : "Flavour"}
                    </td>
                    {reopening && (
                      <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                        {formatGrams(balanceByKey.get(e.key) ?? 0)}
                      </td>
                    )}
                    <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                      {formatGrams(e.qtyG)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {serverError && (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>
              <ArrowLeft /> Back
            </Button>
            <Button
              className="ml-auto"
              disabled={isSubmitting}
              onClick={handleSubmit}
            >
              {isSubmitting ? "Submitting…" : "Submit Opening Stock"}
            </Button>
          </div>
        </div>
      ) : (
        /* ---------------------------------------------------- 3. Submit */
        <div className="bg-card grid gap-3 rounded-lg border p-6 text-center">
          <CircleCheck className="text-success mx-auto size-10" />
          <p className="text-base font-semibold">Opening stock submitted</p>
          <p className="text-muted-foreground text-sm">
            {postedCount === 0
              ? "Every entry already matched current stock, so nothing needed posting."
              : `Posted ${postedCount} opening movement${postedCount === 1 ? "" : "s"} for ${department?.name}.`}{" "}
            This location is now locked — use a stock count adjustment for any
            correction.
          </p>
          <Button
            variant="secondary"
            className="justify-self-center"
            onClick={() => void load(departmentId)}
          >
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
