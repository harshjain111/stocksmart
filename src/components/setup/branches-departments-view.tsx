"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  Archive,
  Building2,
} from "lucide-react";
import {
  createBranchSchema,
  createDepartmentSchema,
  type CreateBranchInput,
  type CreateDepartmentInput,
} from "@/lib/validation/branches";
import {
  archiveDepartment,
  createBranch,
  createDepartment,
  updateDepartment,
} from "@/app/(app)/setup/branches/actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusTag } from "@/components/shared/status-tag";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DepartmentType = "godown" | "office" | "club" | "cafe";

type Branch = { id: string; name: string; is_hq: boolean; is_active: boolean };

type Department = {
  id: string;
  branch_id: string;
  name: string;
  type: DepartmentType;
  holds_raw: boolean;
  holds_mixed: boolean;
  can_mix: boolean;
  hod_id: string | null;
  is_active: boolean;
};

type ProfileOption = {
  id: string;
  full_name: string;
  branch_id: string | null;
};

const DEPARTMENT_TYPES: { value: DepartmentType; label: string }[] = [
  { value: "godown", label: "Godown" },
  { value: "office", label: "Office" },
  { value: "club", label: "Club" },
  { value: "cafe", label: "Cafe" },
];

export function BranchesDepartmentsView({
  branches,
  departments,
  profiles,
}: {
  branches: Branch[];
  departments: Department[];
  profiles: ProfileOption[];
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(branches.map((b) => b.id)),
  );
  const [branchDialogOpen, setBranchDialogOpen] = React.useState(false);
  const [deptDialog, setDeptDialog] = React.useState<{
    branchId: string;
    department: Department | null;
  } | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Department | null>(
    null,
  );

  function toggle(branchId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  }

  const profileNameById = new Map(profiles.map((p) => [p.id, p.full_name]));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Branches & departments"
        description="A branch is a city. A department is the only thing that holds stock."
        action={
          <Button onClick={() => setBranchDialogOpen(true)}>
            <Plus /> Add branch
          </Button>
        }
      />

      {branches.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No branches yet"
          description="Add your first branch (e.g. Guwahati) to start setting up departments."
          actionLabel="Add branch"
          onAction={() => setBranchDialogOpen(true)}
        />
      ) : (
        <div className="grid gap-4">
          {branches.map((branch) => {
            const branchDepartments = departments.filter(
              (d) => d.branch_id === branch.id,
            );
            const isOpen = expanded.has(branch.id);

            const columns: DataTableColumn<Department>[] = [
              {
                key: "name",
                header: "Department",
                render: (d) => (
                  <span className={!d.is_active ? "text-muted-foreground" : ""}>
                    {d.name}
                  </span>
                ),
              },
              {
                key: "type",
                header: "Type",
                render: (d) => <span className="capitalize">{d.type}</span>,
              },
              {
                key: "flags",
                header: "Flags",
                render: (d) => (
                  <div className="flex flex-wrap gap-1">
                    {d.holds_raw && <Badge variant="secondary">raw</Badge>}
                    {d.holds_mixed && <Badge variant="secondary">mixed</Badge>}
                    {d.can_mix && <Badge variant="secondary">can mix</Badge>}
                  </div>
                ),
              },
              {
                key: "hod",
                header: "HOD",
                render: (d) =>
                  d.hod_id ? (profileNameById.get(d.hod_id) ?? "—") : "—",
              },
              {
                key: "status",
                header: "Status",
                render: (d) =>
                  d.is_active ? (
                    <StatusTag status="active" tone="primary" label="Active" />
                  ) : (
                    <StatusTag status="archived" label="Archived" />
                  ),
              },
              {
                key: "actions",
                header: "",
                className: "text-right",
                render: (d) => (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setDeptDialog({ branchId: branch.id, department: d })
                      }
                      aria-label={`Edit ${d.name}`}
                    >
                      <Pencil />
                    </Button>
                    {d.is_active && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setArchiveTarget(d)}
                        aria-label={`Archive ${d.name}`}
                      >
                        <Archive />
                      </Button>
                    )}
                  </div>
                ),
              },
            ];

            return (
              <Card key={branch.id}>
                <CardContent className="grid gap-4">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => toggle(branch.id)}
                      className="flex items-center gap-2 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="text-muted-foreground size-4" />
                      ) : (
                        <ChevronRight className="text-muted-foreground size-4" />
                      )}
                      <span className="font-medium">{branch.name}</span>
                      {branch.is_hq && <Badge>HQ</Badge>}
                      {!branch.is_active && (
                        <StatusTag status="archived" label="Archived" />
                      )}
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDeptDialog({ branchId: branch.id, department: null })
                      }
                    >
                      <Plus /> Add department
                    </Button>
                  </div>

                  {isOpen &&
                    (branchDepartments.length === 0 ? (
                      <EmptyState
                        title="No departments yet"
                        description="Add a department to give this branch somewhere to hold stock."
                        actionLabel="Add department"
                        onAction={() =>
                          setDeptDialog({
                            branchId: branch.id,
                            department: null,
                          })
                        }
                      />
                    ) : (
                      <DataTable
                        columns={columns}
                        data={branchDepartments}
                        getRowKey={(d) => d.id}
                      />
                    ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <BranchDialog
        open={branchDialogOpen}
        onOpenChange={setBranchDialogOpen}
      />

      {deptDialog && (
        <DepartmentDialog
          open={!!deptDialog}
          onOpenChange={(open) => !open && setDeptDialog(null)}
          branchId={deptDialog.branchId}
          department={deptDialog.department}
          profiles={profiles.filter((p) => p.branch_id === deptDialog.branchId)}
        />
      )}

      {archiveTarget && (
        <ConfirmDialog
          open={!!archiveTarget}
          onOpenChange={(open) => !open && setArchiveTarget(null)}
          title={`Archive ${archiveTarget.name}`}
          description="Archived departments stop appearing as a destination for transfers or requisitions. This can only be done when the department holds zero stock."
          confirmPhrase={archiveTarget.name}
          confirmLabel="Archive department"
          onConfirm={async () => {
            const result = await archiveDepartment({ id: archiveTarget.id });
            if (!result.success) throw new Error(result.error);
          }}
        />
      )}
    </div>
  );
}

function BranchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateBranchInput>({
    resolver: zodResolver(createBranchSchema),
    defaultValues: { name: "", isHq: false },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);

  async function onSubmit(values: CreateBranchInput) {
    setServerError(null);
    const result = await createBranch(values);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add branch</DialogTitle>
          <DialogDescription>
            A branch is a city — e.g. Guwahati or Kolkata.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="create-branch-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="branch-name">Name</Label>
            <Input id="branch-name" {...register("name")} />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="isHq"
              render={({ field }) => (
                <Switch
                  id="branch-is-hq"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="branch-is-hq">This is the HQ branch</Label>
          </div>
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-branch-form"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving…" : "Add branch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentDialog({
  open,
  onOpenChange,
  branchId,
  department,
  profiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  department: Department | null;
  profiles: ProfileOption[];
}) {
  const isEdit = !!department;
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateDepartmentInput>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: {
      branchId,
      name: department?.name ?? "",
      type: department?.type ?? "godown",
      holdsRaw: department?.holds_raw ?? false,
      holdsMixed: department?.holds_mixed ?? true,
      canMix: department?.can_mix ?? false,
      hodId: department?.hod_id ?? null,
    },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);

  async function onSubmit(values: CreateDepartmentInput) {
    setServerError(null);
    const result = isEdit
      ? await updateDepartment({ ...values, id: department.id })
      : await createDepartment(values);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit department" : "Add department"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="department-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="dept-name">Name</Label>
            <Input id="dept-name" {...register("name")} />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select
                  items={DEPARTMENT_TYPES}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="holdsRaw"
                render={({ field }) => (
                  <Switch
                    id="dept-holds-raw"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="dept-holds-raw">Holds raw</Label>
            </div>
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="holdsMixed"
                render={({ field }) => (
                  <Switch
                    id="dept-holds-mixed"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="dept-holds-mixed">Holds mixed</Label>
            </div>
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="canMix"
                render={({ field }) => (
                  <Switch
                    id="dept-can-mix"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="dept-can-mix">Can mix</Label>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Head of department</Label>
            <Controller
              control={control}
              name="hodId"
              render={({ field }) => (
                <Select
                  items={[
                    { value: "none", label: "Unassigned" },
                    ...profiles.map((p) => ({
                      value: p.id,
                      label: p.full_name,
                    })),
                  ]}
                  value={field.value ?? "none"}
                  onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="department-form" disabled={isSubmitting}>
            {isSubmitting
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Add department"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
