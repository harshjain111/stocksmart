"use client";

import * as React from "react";
import { CheckCircle2, ListChecks, PackageCheck, Send } from "lucide-react";
import {
  getAllRequisitions,
  getRequisitionTimeline,
  type RequisitionFilters,
} from "@/app/(app)/requisitions/all/actions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { StatCard } from "@/components/shared/stat-card";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type RequisitionRow = {
  id: string;
  reqNo: string;
  branchName: string;
  departmentName: string;
  status: string;
  neededBy: string;
  createdAt: string;
  lineCount: number;
};

type TimelineStep = {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
};

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "fulfilling", label: "Fulfilling" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
];

export function RequisitionsAllView({
  requisitions,
  branches,
  departments,
  isAdmin,
}: {
  requisitions: RequisitionRow[];
  branches: { id: string; name: string }[];
  departments: { id: string; name: string; branchId: string }[];
  isAdmin: boolean;
}) {
  const [rows, setRows] = React.useState(requisitions);
  const [loading, setLoading] = React.useState(false);
  const [branchId, setBranchId] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [raisedFrom, setRaisedFrom] = React.useState("");
  const [raisedTo, setRaisedTo] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const visibleDepartments = branchId
    ? departments.filter((d) => d.branchId === branchId)
    : departments;

  const applyFilters = React.useCallback(
    async (overrides?: Partial<RequisitionFilters>) => {
      setLoading(true);
      const filters: RequisitionFilters = {
        branchId: branchId || undefined,
        departmentId: departmentId || undefined,
        status: status || undefined,
        raisedFrom: raisedFrom ? new Date(raisedFrom).toISOString() : undefined,
        raisedTo: raisedTo
          ? new Date(
              new Date(raisedTo).getTime() + 24 * 60 * 60 * 1000 - 1,
            ).toISOString()
          : undefined,
        ...overrides,
      };
      const result = await getAllRequisitions(filters);
      setLoading(false);
      if (result.success) setRows(result.data);
    },
    [branchId, departmentId, status, raisedFrom, raisedTo],
  );

  const columns: DataTableColumn<RequisitionRow>[] = [
    { key: "reqNo", header: "Requisition", render: (r) => r.reqNo },
    ...(isAdmin
      ? [
          {
            key: "branch",
            header: "Branch",
            render: (r: RequisitionRow) => r.branchName,
          } as DataTableColumn<RequisitionRow>,
        ]
      : []),
    {
      key: "department",
      header: "Department",
      render: (r) => r.departmentName,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusTag status={r.status} />,
    },
    {
      key: "items",
      header: "Items",
      numeric: true,
      render: (r) => String(r.lineCount),
    },
    {
      key: "neededBy",
      header: "Needed by",
      render: (r) => new Date(r.neededBy).toLocaleDateString("en-IN"),
    },
    {
      key: "raised",
      header: "Raised",
      render: (r) => new Date(r.createdAt).toLocaleDateString("en-IN"),
    },
  ];

  const submittedCount = rows.filter((r) => r.status === "submitted").length;
  const fulfillingCount = rows.filter((r) => r.status === "fulfilling").length;
  const closedCount = rows.filter((r) => r.status === "closed").length;

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="All requisitions"
        description="Filter by branch, department, status and date — every requisition, whatever its state."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Requisitions shown"
          value={String(rows.length)}
          icon={ListChecks}
          tone="primary"
          className="col-span-2 sm:col-span-1"
        />
        <StatCard
          label="Submitted"
          value={String(submittedCount)}
          icon={Send}
        />
        <StatCard
          label="Fulfilling"
          value={String(fulfillingCount)}
          icon={PackageCheck}
        />
        <StatCard
          label="Closed"
          value={String(closedCount)}
          icon={CheckCircle2}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {isAdmin && (
          <div className="grid gap-1.5">
            <Label>Branch</Label>
            <Select
              items={[
                { value: "", label: "All branches" },
                ...branches.map((b) => ({ value: b.id, label: b.name })),
              ]}
              value={branchId}
              onValueChange={(v) => {
                setBranchId(v ?? "");
                setDepartmentId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label>Department</Label>
          <Select
            items={[
              { value: "", label: "All departments" },
              ...visibleDepartments.map((d) => ({
                value: d.id,
                label: d.name,
              })),
            ]}
            value={departmentId}
            onValueChange={(v) => setDepartmentId(v ?? "")}
          >
            <SelectTrigger>
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All departments</SelectItem>
              {visibleDepartments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Status</Label>
          <Select
            items={[{ value: "", label: "All statuses" }, ...STATUS_OPTIONS]}
            value={status}
            onValueChange={(v) => setStatus(v ?? "")}
          >
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="raised-from">Raised from</Label>
          <Input
            id="raised-from"
            type="date"
            value={raisedFrom}
            onChange={(e) => setRaisedFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="raised-to">Raised to</Label>
          <Input
            id="raised-to"
            type="date"
            value={raisedTo}
            onChange={(e) => setRaisedTo(e.target.value)}
          />
        </div>
      </div>

      <Button
        onClick={() => applyFilters()}
        disabled={loading}
        className="justify-self-start"
      >
        {loading ? "Loading…" : "Apply filters"}
      </Button>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={loading}
        onRowClick={(r) => setSelectedId(r.id)}
        getRowKey={(r) => r.id}
        emptyState={
          <EmptyState
            icon={ListChecks}
            title="No requisitions match these filters"
            description="Try widening the date range or clearing a filter."
          />
        }
      />

      <TimelineDialog
        requisitionId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  );
}

function TimelineDialog({
  requisitionId,
  onOpenChange,
}: {
  requisitionId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reqNo, setReqNo] = React.useState("");
  const [steps, setSteps] = React.useState<TimelineStep[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!requisitionId) return;
    setLoading(true);
    getRequisitionTimeline(requisitionId).then((result) => {
      setLoading(false);
      if (result.success) {
        setReqNo(result.data.reqNo);
        setSteps(result.data.steps);
      }
    });
  }, [requisitionId]);

  return (
    <Dialog open={!!requisitionId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{reqNo || "Requisition"}</DialogTitle>
          <DialogDescription>
            Where this requisition is right now.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <ol className="grid gap-3">
            {steps.map((step) => (
              <li key={step.key} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    step.done ? "bg-primary" : "bg-muted-foreground/30",
                  )}
                />
                <span
                  className={cn(
                    "flex-1 font-medium",
                    !step.done && "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span className="text-muted-foreground text-xs">
                  {step.at
                    ? new Date(step.at).toLocaleDateString("en-IN", {
                        dateStyle: "medium",
                      })
                    : step.done
                      ? ""
                      : "Pending"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
