"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, History, Boxes, AlertTriangle } from "lucide-react";
import {
  addSupplierRateSchema,
  createMaterialSchema,
  type AddSupplierRateInput,
  type CreateMaterialInput,
  type UpdateMaterialInput,
} from "@/lib/validation/materials";
import {
  addSupplierRate,
  createMaterial,
  updateMaterial,
} from "@/app/(app)/setup/materials/actions";
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
import { Badge } from "@/components/ui/badge";
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

type Material = {
  id: string;
  code: string | null;
  name: string;
  default_supplier_id: string | null;
  is_active: boolean;
};

type Supplier = { id: string; name: string };

type Rate = {
  id: string;
  raw_material_id: string;
  supplier_id: string;
  rate: number;
  source: "manual" | "grn";
  created_at: string;
};

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function MaterialsView({
  materials,
  suppliers,
  rates,
}: {
  materials: Material[];
  suppliers: Supplier[];
  rates: Rate[];
}) {
  const [dialogTarget, setDialogTarget] = React.useState<
    Material | "new" | null
  >(null);
  const [historyTarget, setHistoryTarget] = React.useState<Material | null>(
    null,
  );

  const noSupplierCount = materials.filter(
    (m) => m.is_active && !m.default_supplier_id,
  ).length;

  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
  // rates is ordered newest-first from the query, so the first match per
  // material is its last-known rate.
  const lastRateByMaterial = new Map<string, Rate>();
  for (const r of rates) {
    if (!lastRateByMaterial.has(r.raw_material_id)) {
      lastRateByMaterial.set(r.raw_material_id, r);
    }
  }

  const columns: DataTableColumn<Material>[] = [
    { key: "code", header: "Code", render: (m) => m.code ?? "—" },
    {
      key: "name",
      header: "Name",
      render: (m) => (
        <span className={!m.is_active ? "text-muted-foreground" : ""}>
          {m.name}
        </span>
      ),
    },
    {
      key: "supplier",
      header: "Default supplier",
      render: (m) =>
        m.default_supplier_id
          ? (supplierNameById.get(m.default_supplier_id) ?? "—")
          : "—",
    },
    {
      key: "rate",
      header: "Last-known rate",
      numeric: true,
      render: (m) => {
        const last = lastRateByMaterial.get(m.id);
        return last ? rupees.format(last.rate) : "—";
      },
    },
    {
      key: "status",
      header: "Status",
      render: (m) =>
        m.is_active ? (
          <StatusTag status="active" tone="primary" label="Active" />
        ) : (
          <StatusTag status="archived" label="Archived" />
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (m) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setHistoryTarget(m)}
            aria-label={`Rate history for ${m.name}`}
          >
            <History />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDialogTarget(m)}
            aria-label={`Edit ${m.name}`}
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
        title="Materials"
        description="Raw materials with their preferred supplier and last-known rate."
        action={
          <Button onClick={() => setDialogTarget("new")}>
            <Plus /> Add material
          </Button>
        }
      />

      {materials.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Materials tracked"
            value={String(materials.length)}
            icon={Boxes}
            tone="primary"
          />
          <StatCard
            label="No default supplier"
            value={String(noSupplierCount)}
            detail="active materials missing one"
            icon={AlertTriangle}
          />
        </div>
      )}

      {materials.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No raw materials yet"
          description="Add your first raw material so requisitions and batches have something to reference."
          actionLabel="Add material"
          onAction={() => setDialogTarget("new")}
        />
      ) : (
        <DataTable columns={columns} data={materials} getRowKey={(m) => m.id} />
      )}

      {dialogTarget && (
        <MaterialDialog
          open={!!dialogTarget}
          onOpenChange={(open) => !open && setDialogTarget(null)}
          material={dialogTarget === "new" ? null : dialogTarget}
          suppliers={suppliers}
        />
      )}

      {historyTarget && (
        <RateHistoryDialog
          open={!!historyTarget}
          onOpenChange={(open) => !open && setHistoryTarget(null)}
          material={historyTarget}
          suppliers={suppliers}
          rates={rates.filter((r) => r.raw_material_id === historyTarget.id)}
        />
      )}
    </div>
  );
}

function MaterialDialog({
  open,
  onOpenChange,
  material,
  suppliers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: Material | null;
  suppliers: Supplier[];
}) {
  const isEdit = !!material;
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateMaterialInput>({
    resolver: zodResolver(createMaterialSchema),
    defaultValues: {
      name: material?.name ?? "",
      defaultSupplierId: material?.default_supplier_id ?? null,
    },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);

  async function onSubmit(values: CreateMaterialInput) {
    setServerError(null);
    const result = isEdit
      ? await updateMaterial({
          ...values,
          id: material.id,
        } satisfies UpdateMaterialInput)
      : await createMaterial(values);
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
          <DialogTitle>{isEdit ? "Edit material" : "Add material"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="material-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="material-name">Name</Label>
            <Input id="material-name" {...register("name")} />
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
          </div>
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="material-form" disabled={isSubmitting}>
            {isSubmitting
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Add material"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RateHistoryDialog({
  open,
  onOpenChange,
  material,
  suppliers,
  rates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: Material;
  suppliers: Supplier[];
  rates: Rate[];
}) {
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
  const sorted = [...rates].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const {
    handleSubmit,
    control,
    register,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddSupplierRateInput>({
    resolver: zodResolver(addSupplierRateSchema),
    defaultValues: {
      rawMaterialId: material.id,
      supplierId: material.default_supplier_id ?? "",
      rate: undefined,
    },
  });
  const [serverError, setServerError] = React.useState<string | null>(null);

  async function onSubmit(values: AddSupplierRateInput) {
    setServerError(null);
    const result = await addSupplierRate(values);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    reset({
      rawMaterialId: material.id,
      supplierId: values.supplierId,
      rate: undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rate history — {material.name}</DialogTitle>
        </DialogHeader>

        <div className="grid max-h-64 gap-3 overflow-y-auto">
          {sorted.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No rates recorded yet.
            </p>
          ) : (
            sorted.map((r) => (
              <div
                key={r.id}
                className="flex items-baseline justify-between gap-3 border-l-2 pl-3 text-sm"
              >
                <div>
                  <p className="font-qty">{rupees.format(r.rate)}</p>
                  <p className="text-muted-foreground text-xs">
                    {supplierNameById.get(r.supplier_id) ?? "Unknown supplier"}{" "}
                    · {new Date(r.created_at).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <Badge variant={r.source === "grn" ? "default" : "secondary"}>
                  {r.source === "grn" ? "GRN" : "manual"}
                </Badge>
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-[1fr_auto_auto] items-end gap-2 border-t pt-4"
        >
          <div className="grid gap-1.5">
            <Label className="text-xs">Supplier</Label>
            <Controller
              control={control}
              name="supplierId"
              render={({ field }) => (
                <Select
                  items={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-rate" className="text-xs">
              Rate (₹)
            </Label>
            <Input
              id="new-rate"
              type="number"
              step="0.01"
              className="font-qty w-28"
              {...register("rate")}
            />
          </div>
          <Button type="submit" disabled={isSubmitting}>
            Add rate
          </Button>
          {(errors.supplierId || errors.rate || serverError) && (
            <p className="text-destructive col-span-3 text-sm">
              {errors.supplierId?.message ??
                errors.rate?.message ??
                serverError}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
