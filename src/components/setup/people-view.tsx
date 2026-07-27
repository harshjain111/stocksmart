"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, UserX, UsersRound } from "lucide-react";
import {
  inviteUserSchema,
  updateUserSchema,
  type InviteUserInput,
  type UpdateUserInput,
} from "@/lib/validation/people";
import {
  deactivateUser,
  inviteUser,
  updateUser,
} from "@/app/(app)/setup/people/actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusTag } from "@/components/shared/status-tag";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

type UserRole =
  | "admin"
  | "branch_manager"
  | "store_manager"
  | "purchase_manager"
  | "hod"
  | "senior_mixer"
  | "mixer";

type Person = {
  id: string;
  full_name: string;
  role: UserRole;
  branch_id: string | null;
  is_active: boolean;
  email: string;
  departmentIds: string[];
};

type Branch = { id: string; name: string };
type Department = { id: string; name: string; branch_id: string };

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "branch_manager", label: "Branch manager" },
  { value: "store_manager", label: "Store manager" },
  { value: "purchase_manager", label: "Purchase manager" },
  { value: "hod", label: "HOD" },
  { value: "senior_mixer", label: "Senior mixer" },
  { value: "mixer", label: "Mixer" },
];

export function PeopleView({
  people,
  branches,
  departments,
}: {
  people: Person[];
  branches: Branch[];
  departments: Department[];
}) {
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<Person | null>(null);
  const [deactivateTarget, setDeactivateTarget] = React.useState<Person | null>(
    null,
  );

  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));

  const columns: DataTableColumn<Person>[] = [
    {
      key: "name",
      header: "Name",
      render: (p) => (
        <span className={!p.is_active ? "text-muted-foreground" : ""}>
          {p.full_name}
        </span>
      ),
    },
    { key: "email", header: "Email", render: (p) => p.email },
    {
      key: "role",
      header: "Role",
      render: (p) => (
        <span className="capitalize">{p.role.replace(/_/g, " ")}</span>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      render: (p) =>
        p.branch_id ? (branchNameById.get(p.branch_id) ?? "—") : "—",
    },
    {
      key: "departments",
      header: "Departments",
      render: (p) =>
        p.departmentIds.length > 0
          ? p.departmentIds
              .map((id) => deptNameById.get(id))
              .filter(Boolean)
              .join(", ")
          : "—",
    },
    {
      key: "status",
      header: "Status",
      render: (p) =>
        p.is_active ? (
          <StatusTag status="active" tone="primary" label="Active" />
        ) : (
          <StatusTag status="archived" label="Deactivated" />
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setEditTarget(p)}
            aria-label={`Edit ${p.full_name}`}
          >
            <Pencil />
          </Button>
          {p.is_active && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDeactivateTarget(p)}
              aria-label={`Deactivate ${p.full_name}`}
            >
              <UserX />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="People"
        description="Invite a user by email, assign their role and branch, and (for HODs) the departments they own."
        action={
          <Button onClick={() => setInviteOpen(true)}>
            <Plus /> Invite user
          </Button>
        }
      />

      {people.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No one's been invited yet"
          description="Invite your first teammate to give them access to Smokzy Inventory."
          actionLabel="Invite user"
          onAction={() => setInviteOpen(true)}
        />
      ) : (
        <DataTable columns={columns} data={people} getRowKey={(p) => p.id} />
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        branches={branches}
        departments={departments}
      />

      {editTarget && (
        <EditUserDialog
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          person={editTarget}
          branches={branches}
          departments={departments}
        />
      )}

      {deactivateTarget && (
        <ConfirmDialog
          open={!!deactivateTarget}
          onOpenChange={(open) => !open && setDeactivateTarget(null)}
          title={`Deactivate ${deactivateTarget.full_name}`}
          description="They'll immediately lose access to Smokzy Inventory. This does not delete their account or history — you can't undo it from here, though."
          confirmPhrase={deactivateTarget.full_name}
          confirmLabel="Deactivate"
          onConfirm={async () => {
            const result = await deactivateUser({ id: deactivateTarget.id });
            if (!result.success) throw new Error(result.error);
          }}
        />
      )}
    </div>
  );
}

function DepartmentChecklist({
  departments,
  branchId,
  value,
  onChange,
}: {
  departments: Department[];
  branchId: string | undefined;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const scoped = departments.filter((d) => d.branch_id === branchId);

  if (!branchId) {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a branch first to choose departments.
      </p>
    );
  }
  if (scoped.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No departments in this branch yet.
      </p>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      {scoped.map((d) => (
        <div key={d.id} className="flex items-center gap-2">
          <Checkbox
            id={`dept-${d.id}`}
            checked={value.includes(d.id)}
            onCheckedChange={(checked) =>
              onChange(
                checked ? [...value, d.id] : value.filter((id) => id !== d.id),
              )
            }
          />
          <Label htmlFor={`dept-${d.id}`}>{d.name}</Label>
        </div>
      ))}
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  branches,
  departments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Branch[];
  departments: Department[];
}) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: {
      email: "",
      fullName: "",
      role: "hod",
      branchId: branches[0]?.id ?? "",
      departmentIds: [],
    },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);
  const role = watch("role");
  const branchId = watch("branchId");

  async function onSubmit(values: InviteUserInput) {
    setServerError(null);
    const result = await inviteUser(values);
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
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email to set their password and sign in.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="invite-user-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" {...register("email")} />
            {errors.email && (
              <p className="text-destructive text-sm">{errors.email.message}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-name">Full name</Label>
            <Input id="invite-name" {...register("fullName")} />
            {errors.fullName && (
              <p className="text-destructive text-sm">
                {errors.fullName.message}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select
                  items={ROLE_OPTIONS}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Branch</Label>
            <Controller
              control={control}
              name="branchId"
              render={({ field }) => (
                <Select
                  items={branches.map((b) => ({ value: b.id, label: b.name }))}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a branch" />
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
            />
          </div>
          {role === "hod" && (
            <div className="grid gap-1.5">
              <Label>Departments</Label>
              <Controller
                control={control}
                name="departmentIds"
                render={({ field }) => (
                  <DepartmentChecklist
                    departments={departments}
                    branchId={branchId}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
          )}
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="invite-user-form" disabled={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  open,
  onOpenChange,
  person,
  branches,
  departments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Person;
  branches: Branch[];
  departments: Department[];
}) {
  const {
    handleSubmit,
    control,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      id: person.id,
      role: person.role,
      branchId: person.branch_id ?? "",
      departmentIds: person.departmentIds,
    },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);
  const role = watch("role");
  const branchId = watch("branchId");

  async function onSubmit(values: UpdateUserInput) {
    setServerError(null);
    const result = await updateUser(values);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
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
          <DialogTitle>Edit {person.full_name}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="edit-user-form"
        >
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select
                  items={ROLE_OPTIONS}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Branch</Label>
            <Controller
              control={control}
              name="branchId"
              render={({ field }) => (
                <Select
                  items={branches.map((b) => ({ value: b.id, label: b.name }))}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a branch" />
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
            />
          </div>
          {role === "hod" && (
            <div className="grid gap-1.5">
              <Label>Departments</Label>
              <Controller
                control={control}
                name="departmentIds"
                render={({ field }) => (
                  <DepartmentChecklist
                    departments={departments}
                    branchId={branchId}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
          )}
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-user-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
