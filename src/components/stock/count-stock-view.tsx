"use client";

import * as React from "react";
import { ClipboardList } from "lucide-react";
import {
  getActiveCountForDepartment,
  generateCountSheet,
  updateCountLine,
} from "@/app/(app)/stock/count/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatGrams } from "@/lib/units";

type Department = {
  id: string;
  name: string;
  branchName: string;
  holdsRaw: boolean;
  holdsMixed: boolean;
};

type CountLine = {
  id: string;
  itemType: "raw" | "flavour";
  itemId: string;
  name: string;
  code: string | null;
  systemQtyG: number;
  countedQtyG: number | null;
  reason: string | null;
};

type CountSheet = {
  countId: string;
  countNo: string;
  status: "draft" | "submitted" | "approved";
  lines: CountLine[];
};

export function CountStockView({ departments }: { departments: Department[] }) {
  const [departmentId, setDepartmentId] = React.useState(
    departments[0]?.id ?? "",
  );
  const department = departments.find((d) => d.id === departmentId);

  const [loading, setLoading] = React.useState(true);
  const [sheet, setSheet] = React.useState<CountSheet | null>(null);
  const [countRaw, setCountRaw] = React.useState(false);
  const [countFlavour, setCountFlavour] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [savedLineIds, setSavedLineIds] = React.useState<Set<string>>(
    new Set(),
  );

  const load = React.useCallback(async (id: string) => {
    setLoading(true);
    setServerError(null);
    setSheet(null);
    const result = await getActiveCountForDepartment(id);
    setLoading(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setSheet(result.data);
    if (result.data) {
      setValues(
        Object.fromEntries(
          result.data.lines.map((l) => [
            l.id,
            l.countedQtyG != null ? String(l.countedQtyG / 1000) : "",
          ]),
        ),
      );
    }
  }, []);

  React.useEffect(() => {
    if (departmentId) load(departmentId);
    const dept = departments.find((d) => d.id === departmentId);
    setCountRaw(dept?.holdsRaw ?? false);
    setCountFlavour(dept?.holdsMixed ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  async function handleGenerate() {
    if (!department) return;
    setServerError(null);
    setGenerating(true);
    const result = await generateCountSheet(
      department.id,
      countRaw,
      countFlavour,
    );
    setGenerating(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setSheet(result.data);
    setValues({});
  }

  async function handleBlur(lineId: string) {
    const value = values[lineId];
    const countedQtyG =
      value === undefined || value.trim() === ""
        ? null
        : Math.round(parseFloat(value) * 1000) || 0;
    const result = await updateCountLine(lineId, countedQtyG);
    if (result.success) {
      setSavedLineIds((prev) => new Set(prev).add(lineId));
      setTimeout(
        () =>
          setSavedLineIds((prev) => {
            const next = new Set(prev);
            next.delete(lineId);
            return next;
          }),
        1500,
      );
    }
  }

  if (departments.length === 0) {
    return (
      <div className="grid gap-6 p-6">
        <PageHeader title="Count stock" />
        <EmptyState
          icon={ClipboardList}
          title="No departments yet"
          description="Add departments under Setup > Branches & departments first."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Count stock"
        description="System quantity beside a blank counted box — the difference updates as you type."
      />

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
      ) : serverError && !sheet ? (
        <p className="text-destructive text-sm">{serverError}</p>
      ) : sheet ? (
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{sheet.countNo}</p>
            <StatusTag status={sheet.status} />
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                    Item
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    System quantity
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Counted (kg)
                  </th>
                  <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody>
                {sheet.lines.map((line) => {
                  const value = values[line.id] ?? "";
                  const hasValue = value.trim() !== "";
                  const countedG = hasValue
                    ? Math.round((parseFloat(value) || 0) * 1000)
                    : null;
                  const diffG =
                    countedG != null ? countedG - line.systemQtyG : null;
                  return (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {line.name}
                        {line.code && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {line.code}
                          </span>
                        )}
                      </td>
                      <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                        {formatGrams(line.systemQtyG)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0"
                          disabled={sheet.status !== "draft"}
                          className="font-qty ml-auto w-28 text-right"
                          value={value}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [line.id]: e.target.value,
                            }))
                          }
                          onBlur={() => handleBlur(line.id)}
                        />
                        {savedLineIds.has(line.id) && (
                          <span className="text-primary block text-xs">
                            Saved
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "font-qty px-3 py-2 text-right whitespace-nowrap",
                          diffG != null &&
                            diffG !== 0 &&
                            (diffG > 0
                              ? "text-warning-foreground"
                              : "text-destructive"),
                        )}
                      >
                        {diffG == null
                          ? "—"
                          : `${diffG > 0 ? "+" : ""}${formatGrams(diffG)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <p className="text-muted-foreground text-sm">
            No draft count for this department yet. Choose what to count and
            generate a sheet.
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="count-raw"
                checked={countRaw}
                disabled={!department?.holdsRaw}
                onCheckedChange={(checked) => setCountRaw(checked === true)}
              />
              <Label htmlFor="count-raw">Raw materials</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="count-flavour"
                checked={countFlavour}
                disabled={!department?.holdsMixed}
                onCheckedChange={(checked) => setCountFlavour(checked === true)}
              />
              <Label htmlFor="count-flavour">Mixed flavours</Label>
            </div>
          </div>
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
          <Button
            disabled={(!countRaw && !countFlavour) || generating}
            onClick={handleGenerate}
            className="justify-self-start"
          >
            {generating ? "Generating…" : "Generate count sheet"}
          </Button>
        </div>
      )}
    </div>
  );
}
