"use client";

import * as React from "react";
import { Package, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatGrams } from "@/lib/units";

type Branch = { id: string; name: string };
type Department = {
  id: string;
  name: string;
  branch_id: string;
  holds_raw: boolean;
  holds_mixed: boolean;
};
type Item = { id: string; code: string | null; name: string };
type Balance = {
  department_id: string;
  item_type: "raw" | "flavour";
  item_id: string;
  qty_g: number;
};
type ParLevel = { department_id: string; item_id: string; par_qty_g: number };

export function WhatWeHaveView({
  branches,
  departments,
  rawMaterials,
  flavours,
  balances,
  parLevels,
  lockedToBranchId,
}: {
  branches: Branch[];
  departments: Department[];
  rawMaterials: Item[];
  flavours: Item[];
  balances: Balance[];
  parLevels: ParLevel[];
  lockedToBranchId: string | null;
}) {
  const [mode, setMode] = React.useState<"raw" | "flavour">("raw");
  const [branchId, setBranchId] = React.useState(
    lockedToBranchId ?? branches[0]?.id ?? "",
  );

  const scopedDepartments = departments.filter(
    (d) => !branchId || d.branch_id === branchId,
  );

  const balanceByKey = new Map(
    balances.map((b) => [
      `${b.department_id}|${b.item_type}|${b.item_id}`,
      b.qty_g,
    ]),
  );
  const parByKey = new Map(
    parLevels.map((p) => [`${p.department_id}|${p.item_id}`, p.par_qty_g]),
  );

  const rawDepartments = scopedDepartments.filter((d) => d.holds_raw);
  const rawRows = rawMaterials.map((m) => {
    const qtyG = rawDepartments.reduce(
      (sum, d) => sum + (balanceByKey.get(`${d.id}|raw|${m.id}`) ?? 0),
      0,
    );
    return { id: m.id, code: m.code, name: m.name, qtyG };
  });

  const mixedDepartments = scopedDepartments.filter((d) => d.holds_mixed);

  const rawColumns: DataTableColumn<(typeof rawRows)[number]>[] = [
    {
      key: "material",
      header: "Material",
      render: (r) => (
        <>
          {r.name}
          {r.code && <span className="text-muted-foreground"> · {r.code}</span>}
        </>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      numeric: true,
      render: (r) => formatGrams(r.qtyG),
    },
    {
      key: "inbound",
      header: "Inbound on order",
      numeric: true,
      render: () => <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="What we have"
        description="Raw materials and mixed flavour stock, by department."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg border p-1">
          <Button
            type="button"
            variant={mode === "raw" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("raw")}
          >
            <Package /> Raw materials
          </Button>
          <Button
            type="button"
            variant={mode === "flavour" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("flavour")}
          >
            <FlaskConical /> Mixed flavours
          </Button>
        </div>

        {!lockedToBranchId && branches.length > 1 && (
          <Select
            items={branches.map((b) => ({ value: b.id, label: b.name }))}
            value={branchId}
            onValueChange={(v) => v && setBranchId(v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {mode === "raw" ? (
        rawMaterials.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No raw materials yet"
            description="Add raw materials under Setup > Materials & flavours."
          />
        ) : (
          <DataTable
            columns={rawColumns}
            data={rawRows}
            getRowKey={(r) => r.id}
          />
        )
      ) : flavours.length === 0 || mixedDepartments.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="Nothing to show"
          description={
            flavours.length === 0
              ? "Add a flavour under Setup > Materials & flavours."
              : "No department in this branch is flagged to hold mixed flavours."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                  Flavour
                </th>
                {mixedDepartments.map((d) => (
                  <th
                    key={d.id}
                    className="text-muted-foreground px-3 py-2 text-right font-medium whitespace-nowrap"
                  >
                    {d.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flavours.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {f.name}
                    {f.code && (
                      <span className="text-muted-foreground"> · {f.code}</span>
                    )}
                  </td>
                  {mixedDepartments.map((d) => {
                    const qtyG =
                      balanceByKey.get(`${d.id}|flavour|${f.id}`) ?? 0;
                    const parG = parByKey.get(`${d.id}|${f.id}`);
                    const belowPar = parG != null && qtyG < parG;
                    return (
                      <td
                        key={d.id}
                        className={cn(
                          "font-qty px-3 py-2 text-right whitespace-nowrap",
                          belowPar && "text-destructive font-semibold",
                        )}
                      >
                        {formatGrams(qtyG)}
                        {parG != null && (
                          <span
                            className={cn(
                              "block text-xs font-normal",
                              belowPar
                                ? "text-destructive/80"
                                : "text-muted-foreground",
                            )}
                          >
                            / {formatGrams(parG)} par
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
