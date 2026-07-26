"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Archive, Search, Truck } from "lucide-react";
import {
  createSupplierSchema,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from "@/lib/validation/suppliers";
import {
  archiveSupplier,
  createSupplier,
  updateSupplier,
} from "@/app/(app)/setup/suppliers/actions";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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

type Supplier = {
  id: string;
  name: string;
  area: string | null;
  contact_person: string | null;
  phone: string | null;
  gstin: string | null;
  notes: string | null;
  is_active: boolean;
};

const STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

export function SuppliersView({ suppliers }: { suppliers: Supplier[] }) {
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<
    "active" | "archived" | "all"
  >("active");
  const [dialogTarget, setDialogTarget] = React.useState<
    Supplier | null | "new"
  >(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Supplier | null>(
    null,
  );

  const filtered = suppliers.filter((s) => {
    if (statusFilter === "active" && !s.is_active) return false;
    if (statusFilter === "archived" && s.is_active) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.area ?? "").toLowerCase().includes(q) ||
      (s.contact_person ?? "").toLowerCase().includes(q) ||
      (s.phone ?? "").toLowerCase().includes(q) ||
      (s.gstin ?? "").toLowerCase().includes(q)
    );
  });

  const columns: DataTableColumn<Supplier>[] = [
    {
      key: "name",
      header: "Name",
      render: (s) => (
        <span className={!s.is_active ? "text-muted-foreground" : ""}>
          {s.name}
        </span>
      ),
    },
    { key: "area", header: "Area", render: (s) => s.area ?? "—" },
    {
      key: "contact",
      header: "Contact person",
      render: (s) => s.contact_person ?? "—",
    },
    { key: "phone", header: "Phone", render: (s) => s.phone ?? "—" },
    { key: "gstin", header: "GSTIN", render: (s) => s.gstin ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (s) =>
        s.is_active ? (
          <StatusTag status="active" tone="primary" label="Active" />
        ) : (
          <StatusTag status="archived" label="Archived" />
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (s) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDialogTarget(s)}
            aria-label={`Edit ${s.name}`}
          >
            <Pencil />
          </Button>
          {s.is_active && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setArchiveTarget(s)}
              aria-label={`Archive ${s.name}`}
            >
              <Archive />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Suppliers"
        description="Rate history lives on each material, not here — this is just who to buy from."
        action={
          <Button onClick={() => setDialogTarget("new")}>
            <Plus /> Add supplier
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, area, contact, phone, GSTIN"
            className="pl-8"
          />
        </div>
        <Select
          items={STATUS_FILTERS}
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={suppliers.length === 0 ? "No suppliers yet" : "No matches"}
          description={
            suppliers.length === 0
              ? "Add your first supplier to start raising purchase orders against them."
              : "Try a different search term or status filter."
          }
          actionLabel={suppliers.length === 0 ? "Add supplier" : undefined}
          onAction={
            suppliers.length === 0 ? () => setDialogTarget("new") : undefined
          }
        />
      ) : (
        <DataTable columns={columns} data={filtered} getRowKey={(s) => s.id} />
      )}

      {dialogTarget && (
        <SupplierDialog
          open={!!dialogTarget}
          onOpenChange={(open) => !open && setDialogTarget(null)}
          supplier={dialogTarget === "new" ? null : dialogTarget}
        />
      )}

      {archiveTarget && (
        <ConfirmDialog
          open={!!archiveTarget}
          onOpenChange={(open) => !open && setArchiveTarget(null)}
          title={`Archive ${archiveTarget.name}`}
          description="Archived suppliers stop appearing when drafting new purchase orders. Existing orders and rate history are untouched."
          confirmPhrase={archiveTarget.name}
          confirmLabel="Archive supplier"
          onConfirm={async () => {
            const result = await archiveSupplier({ id: archiveTarget.id });
            if (!result.success) throw new Error(result.error);
          }}
        />
      )}
    </div>
  );
}

function SupplierDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier | null;
}) {
  const isEdit = !!supplier;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateSupplierInput>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: {
      name: supplier?.name ?? "",
      area: supplier?.area ?? "",
      contactPerson: supplier?.contact_person ?? "",
      phone: supplier?.phone ?? "",
      gstin: supplier?.gstin ?? "",
      notes: supplier?.notes ?? "",
    },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);

  async function onSubmit(values: CreateSupplierInput) {
    setServerError(null);
    const result = isEdit
      ? await updateSupplier({
          ...values,
          id: supplier.id,
        } satisfies UpdateSupplierInput)
      : await createSupplier(values);
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
          <DialogTitle>{isEdit ? "Edit supplier" : "Add supplier"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="supplier-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-name">Name</Label>
            <Input id="supplier-name" {...register("name")} />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="supplier-area">Area</Label>
              <Input id="supplier-area" {...register("area")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supplier-phone">Phone</Label>
              <Input id="supplier-phone" {...register("phone")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="supplier-contact">Contact person</Label>
              <Input id="supplier-contact" {...register("contactPerson")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supplier-gstin">GSTIN</Label>
              <Input id="supplier-gstin" {...register("gstin")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-notes">Notes</Label>
            <Textarea id="supplier-notes" rows={3} {...register("notes")} />
          </div>
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="supplier-form" disabled={isSubmitting}>
            {isSubmitting
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Add supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
