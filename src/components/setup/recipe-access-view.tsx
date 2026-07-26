"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AccessLogRow = {
  id: string;
  userName: string;
  flavourName: string;
  flavourCode: string | null;
  versionNo: number | null;
  createdAt: string;
};

const ALL = "__all__";

export function RecipeAccessView({ accessLog }: { accessLog: AccessLogRow[] }) {
  const [userFilter, setUserFilter] = React.useState(ALL);
  const [flavourFilter, setFlavourFilter] = React.useState(ALL);

  const users = [...new Set(accessLog.map((r) => r.userName))].sort();
  const flavours = [...new Set(accessLog.map((r) => r.flavourName))].sort();

  const filtered = accessLog.filter(
    (r) =>
      (userFilter === ALL || r.userName === userFilter) &&
      (flavourFilter === ALL || r.flavourName === flavourFilter),
  );

  const columns: DataTableColumn<AccessLogRow>[] = [
    { key: "user", header: "User", render: (r) => r.userName },
    {
      key: "flavour",
      header: "Flavour",
      render: (r) => (
        <>
          {r.flavourName}
          {r.flavourCode && (
            <span className="text-muted-foreground"> · {r.flavourCode}</span>
          )}
        </>
      ),
    },
    {
      key: "version",
      header: "Version",
      render: (r) => (r.versionNo ? `v${r.versionNo}` : "—"),
    },
    {
      key: "when",
      header: "When",
      render: (r) =>
        new Date(r.createdAt).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Recipe access"
        description="Every read of a recipe version's formula, logged."
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select
          items={[
            { value: ALL, label: "All users" },
            ...users.map((u) => ({ value: u, label: u })),
          ]}
          value={userFilter}
          onValueChange={(v) => v && setUserFilter(v)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All users</SelectItem>
            {users.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={[
            { value: ALL, label: "All flavours" },
            ...flavours.map((f) => ({ value: f, label: f })),
          ]}
          value={flavourFilter}
          onValueChange={(v) => v && setFlavourFilter(v)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All flavours</SelectItem>
            {flavours.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={accessLog.length === 0 ? "No recipe reads yet" : "No matches"}
          description={
            accessLog.length === 0
              ? "Every time admin or senior_mixer views a recipe version, it shows up here."
              : "Try a different user or flavour filter."
          }
        />
      ) : (
        <DataTable columns={columns} data={filtered} getRowKey={(r) => r.id} />
      )}
    </div>
  );
}
