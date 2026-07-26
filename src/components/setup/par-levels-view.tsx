"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Gauge } from "lucide-react";
import { formatGrams } from "@/lib/units";
import { saveParLevels } from "@/app/(app)/setup/par-levels/actions";

type Department = {
  id: string;
  name: string;
  branchName: string;
  holdsRaw: boolean;
  holdsMixed: boolean;
};
type Item = { id: string; code: string | null; name: string };
type Balance = {
  department_id: string;
  item_type: "raw" | "flavour";
  item_id: string;
  qty_g: number;
};
type ParLevel = {
  department_id: string;
  item_type: "raw" | "flavour";
  item_id: string;
  par_qty_g: number;
};

export function ParLevelsView({
  departments,
  rawMaterials,
  flavours,
  balances,
  parLevels,
}: {
  departments: Department[];
  rawMaterials: Item[];
  flavours: Item[];
  balances: Balance[];
  parLevels: ParLevel[];
}) {
  const router = useRouter();
  const [departmentId, setDepartmentId] = React.useState(
    departments[0]?.id ?? "",
  );
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null);

  const department = departments.find((d) => d.id === departmentId);

  const balanceByKey = new Map(
    balances.map((b) => [
      `${b.department_id}|${b.item_type}|${b.item_id}`,
      b.qty_g,
    ]),
  );
  const parByKey = new Map(
    parLevels.map((p) => [
      `${p.department_id}|${p.item_type}|${p.item_id}`,
      p.par_qty_g,
    ]),
  );

  type Row = { itemType: "raw" | "flavour"; item: Item };
  const rows: Row[] = [
    ...(department?.holdsRaw
      ? rawMaterials.map((item) => ({ itemType: "raw" as const, item }))
      : []),
    ...(department?.holdsMixed
      ? flavours.map((item) => ({ itemType: "flavour" as const, item }))
      : []),
  ];

  function selectDepartment(id: string) {
    setDepartmentId(id);
    setEdits({});
    setServerError(null);
    setSavedMessage(null);
  }

  function editValue(key: string) {
    return edits[key];
  }

  const hasChanges = Object.keys(edits).length > 0;

  async function handleSave() {
    if (!department) return;
    setServerError(null);
    setSavedMessage(null);
    setIsSaving(true);

    const entries = rows
      .map((r) => {
        const key = `${r.itemType}|${r.item.id}`;
        const edited = edits[key];
        if (edited === undefined) return null;
        return {
          itemType: r.itemType,
          itemId: r.item.id,
          parQtyG: Math.round(parseFloat(edited) * 1000) || 0,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const result = await saveParLevels({
      departmentId: department.id,
      entries,
    });
    setIsSaving(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setEdits({});
    setSavedMessage(
      `Saved ${entries.length} par level${entries.length === 1 ? "" : "s"}.`,
    );
    router.refresh();
  }

  if (departments.length === 0) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Par levels" />
        <EmptyState
          icon={Gauge}
          title="No departments yet"
          description="Add departments under Setup > Branches & departments first."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Par levels"
        description="Per department, per item — the target stock that below-par highlighting on Stock > What we have compares against."
      />

      <Select
        items={departments.map((d) => ({
          value: d.id,
          label: `${d.name} (${d.branchName})`,
        }))}
        value={departmentId}
        onValueChange={(v) => v && selectDepartment(v)}
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

      {rows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="Nothing to set a par for"
          description={
            !department?.holdsRaw && !department?.holdsMixed
              ? "This department doesn't hold raw materials or mixed flavours."
              : "No active raw materials or flavours exist yet — add some under Setup > Materials & flavours."
          }
        />
      ) : (
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
                  Par (kg)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.itemType}|${r.item.id}`;
                const balanceKey = `${departmentId}|${r.itemType}|${r.item.id}`;
                const currentG = balanceByKey.get(balanceKey) ?? 0;
                const currentParG = parByKey.get(balanceKey) ?? 0;
                const value = editValue(key) ?? String(currentParG / 1000);
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
                          setEdits((prev) => ({
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

      {serverError && <p className="text-destructive text-sm">{serverError}</p>}
      {savedMessage && <p className="text-primary text-sm">{savedMessage}</p>}

      {rows.length > 0 && (
        <Button
          disabled={!hasChanges || isSaving}
          onClick={handleSave}
          className="justify-self-start"
        >
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      )}
    </div>
  );
}
