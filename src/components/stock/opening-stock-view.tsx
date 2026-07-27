"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, PackageOpen, Package, FlaskConical, Building2 } from "lucide-react";
import {
  getDepartmentOpeningData,
  submitOpeningStock,
} from "@/app/(app)/stock/opening/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatGrams } from "@/lib/units";

type Department = {
  id: string;
  name: string;
  branchName: string;
  holdsRaw: boolean;
  holdsMixed: boolean;
};
type Item = { id: string; code: string | null; name: string };

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
  const [loading, setLoading] = React.useState(true);
  const [isLocked, setIsLocked] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [balanceByKey, setBalanceByKey] = React.useState<Map<string, number>>(
    new Map(),
  );
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null);

  const department = departments.find((d) => d.id === departmentId);

  const load = React.useCallback(async (id: string) => {
    setLoading(true);
    setReopening(false);
    setServerError(null);
    setSavedMessage(null);
    const result = await getDepartmentOpeningData(id);
    setLoading(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setIsLocked(result.data.isLocked);
    const map = new Map(
      result.data.balances.map((b) => [`${b.itemType}|${b.itemId}`, b.qtyG]),
    );
    setBalanceByKey(map);
    setValues({});
  }, []);

  React.useEffect(() => {
    if (departmentId) load(departmentId);
  }, [departmentId, load]);

  type Row = { itemType: "raw" | "flavour"; item: Item };
  const rows: Row[] = [
    ...(department?.holdsRaw
      ? rawMaterials.map((item) => ({ itemType: "raw" as const, item }))
      : []),
    ...(department?.holdsMixed
      ? flavours.map((item) => ({ itemType: "flavour" as const, item }))
      : []),
  ];

  const hasChanges = Object.keys(values).length > 0;

  async function handleSubmit() {
    if (!department) return;
    setServerError(null);
    setSavedMessage(null);
    setIsSubmitting(true);

    const entries = rows
      .map((r) => {
        const key = `${r.itemType}|${r.item.id}`;
        const edited = values[key];
        if (edited === undefined) return null;
        return {
          itemType: r.itemType,
          itemId: r.item.id,
          desiredQtyG: Math.round((parseFloat(edited) || 0) * 1000),
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const result = await submitOpeningStock({
      departmentId: department.id,
      entries,
      reopen: reopening,
    });
    setIsSubmitting(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setSavedMessage(
      result.data.postedCount === 0
        ? "No changes to post — every entry already matched current stock."
        : `Posted ${result.data.postedCount} opening movement${result.data.postedCount === 1 ? "" : "s"}.`,
    );
    router.refresh();
    load(department.id);
  }

  if (departments.length === 0) {
    return (
      <div className="grid gap-6 p-6">
        <PageHeader title="Opening stock" />
        <EmptyState
          icon={PackageOpen}
          title="No departments yet"
          description="Add departments under Setup > Branches & departments first."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Opening stock"
        description="One-time starting quantities per department. Locks once submitted."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Items to open"
          value={String(rawMaterials.length + flavours.length)}
          detail="raw materials & flavours"
          icon={PackageOpen}
          tone="primary"
          className="col-span-2 sm:col-span-1"
        />
        <StatCard
          label="Raw materials"
          value={String(rawMaterials.length)}
          icon={Package}
        />
        <StatCard
          label="Mixed flavours"
          value={String(flavours.length)}
          icon={FlaskConical}
        />
        <StatCard
          label="Departments"
          value={String(departments.length)}
          icon={Building2}
        />
      </div>

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

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Nothing to open"
          description={
            !department?.holdsRaw && !department?.holdsMixed
              ? "This department doesn't hold raw materials or mixed flavours."
              : "No active raw materials or flavours exist yet — add some under Setup > Materials & flavours."
          }
        />
      ) : isLocked && !reopening ? (
        <div className="grid gap-4">
          <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-lg border p-3 text-sm">
            <Lock className="text-warning-foreground mt-0.5 size-4 shrink-0" />
            <p>
              Opening stock has already been submitted for this department.
              {isAdmin
                ? " As admin, you can reopen it to post a correction."
                : " Only admin can reopen it."}
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                    Item
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Current stock
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.itemType}|${r.item.id}`;
                  return (
                    <tr key={key} className="border-b last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.item.name}
                        {r.item.code && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {r.item.code}
                          </span>
                        )}
                      </td>
                      <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
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
      ) : (
        <div className="grid gap-4">
          {reopening && (
            <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-lg border p-3 text-sm">
              <Lock className="text-warning-foreground mt-0.5 size-4 shrink-0" />
              <p>
                Reopened for correction — entering a new value posts the
                difference from current stock, not a replacement. This is
                logged.
              </p>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                    Item
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Current stock
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Starting quantity (kg)
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.itemType}|${r.item.id}`;
                  const currentG = balanceByKey.get(key) ?? 0;
                  const value = values[key] ?? String(currentG / 1000);
                  return (
                    <tr key={key} className="border-b last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.item.name}
                        {r.item.code && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {r.item.code}
                          </span>
                        )}
                      </td>
                      <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                        {formatGrams(currentG)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0"
                          className="font-qty ml-auto w-28 text-right"
                          value={value}
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

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
          {savedMessage && (
            <p className="text-primary text-sm">{savedMessage}</p>
          )}

          <Button
            disabled={!hasChanges || isSubmitting}
            onClick={handleSubmit}
            className="justify-self-start"
          >
            {isSubmitting ? "Submitting…" : "Submit opening stock"}
          </Button>
        </div>
      )}
    </div>
  );
}
