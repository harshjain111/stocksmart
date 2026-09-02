"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Droplet, AlertTriangle } from "lucide-react";
import {
  createFlavourSchema,
  type CreateFlavourInput,
  type UpdateFlavourInput,
} from "@/lib/validation/flavours";
import {
  createFlavour,
  updateFlavour,
} from "@/app/(app)/setup/materials/flavour-actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusTag } from "@/components/shared/status-tag";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Flavour = {
  id: string;
  code: string | null;
  name: string;
  current_version_id: string | null;
  default_supplier_id: string | null;
  is_active: boolean;
};
type Supplier = { id: string; name: string };

export function FlavoursView({
  flavours,
  suppliers,
}: {
  flavours: Flavour[];
  suppliers: Supplier[];
}) {
  const [dialogTarget, setDialogTarget] = React.useState<
    Flavour | "new" | null
  >(null);

  const noRecipeCount = flavours.filter(
    (f) => f.is_active && !f.current_version_id,
  ).length;
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));

  const columns: DataTableColumn<Flavour>[] = [
    { key: "code", header: "Code", render: (f) => f.code ?? "—" },
    {
      key: "name",
      header: "Name",
      render: (f) => (
        <span className={!f.is_active ? "text-muted-foreground" : ""}>
          {f.name}
        </span>
      ),
    },
    {
      key: "recipe",
      header: "Recipe",
      render: (f) =>
        f.current_version_id ? (
          <StatusTag status="current" label="Has a version" />
        ) : (
          <span className="text-muted-foreground">No recipe yet</span>
        ),
    },
    {
      key: "supplier",
      header: "Default supplier",
      render: (f) =>
        f.default_supplier_id ? (
          (supplierNameById.get(f.default_supplier_id) ?? "Unknown supplier")
        ) : (
          <span className="text-muted-foreground">Not assigned</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (f) =>
        f.is_active ? (
          <StatusTag status="active" tone="primary" label="Active" />
        ) : (
          <StatusTag status="archived" label="Archived" />
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (f) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDialogTarget(f)}
            aria-label={`Edit ${f.name}`}
          >
            <Pencil />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Flavours"
        description="Creating a flavour here doesn't create a recipe — that happens on the Recipes screen."
        action={
          <Button onClick={() => setDialogTarget("new")}>
            <Plus /> Add flavour
          </Button>
        }
      />

      {flavours.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Flavours"
            value={String(flavours.length)}
            icon={Droplet}
            tone="primary"
          />
          <StatCard
            label="No recipe yet"
            value={String(noRecipeCount)}
            detail="active flavours without a version"
            icon={AlertTriangle}
          />
        </div>
      )}

      {flavours.length === 0 ? (
        <EmptyState
          icon={Droplet}
          title="No flavours yet"
          description="Add a flavour here, then build its recipe on the Recipes screen."
          actionLabel="Add flavour"
          onAction={() => setDialogTarget("new")}
        />
      ) : (
        <DataTable columns={columns} data={flavours} getRowKey={(f) => f.id} />
      )}

      {dialogTarget && (
        <FlavourDialog
          open={!!dialogTarget}
          onOpenChange={(open) => !open && setDialogTarget(null)}
          flavour={dialogTarget === "new" ? null : dialogTarget}
          suppliers={suppliers}
        />
      )}
    </div>
  );
}

function FlavourDialog({
  open,
  onOpenChange,
  flavour,
  suppliers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flavour: Flavour | null;
  suppliers: Supplier[];
}) {
  const isEdit = !!flavour;
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateFlavourInput>({
    resolver: zodResolver(createFlavourSchema),
    defaultValues: {
      name: flavour?.name ?? "",
      defaultSupplierId: flavour?.default_supplier_id ?? null,
    },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);

  async function onSubmit(values: CreateFlavourInput) {
    setServerError(null);
    const result = isEdit
      ? await updateFlavour({
          ...values,
          id: flavour.id,
        } satisfies UpdateFlavourInput)
      : await createFlavour(values);
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
          <DialogTitle>{isEdit ? "Edit flavour" : "Add flavour"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="flavour-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="flavour-name">Name</Label>
            <Input id="flavour-name" {...register("name")} />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Default supplier</Label>
            <Controller
              control={control}
              name="defaultSupplierId"
              render={({ field }) => (
                <Select
                  items={[
                    { value: "none", label: "None" },
                    ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  value={field.value ?? "none"}
                  onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-muted-foreground text-xs">
              Used when this flavour is bought ready-made — Purchases groups
              it under this supplier.
            </p>
          </div>
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="flavour-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Add flavour"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
