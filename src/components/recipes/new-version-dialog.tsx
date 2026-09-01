"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { createRecipeVersion } from "@/app/(app)/recipes/actions";
import { createMaterial } from "@/app/(app)/setup/materials/actions";
import { createSupplier } from "@/app/(app)/setup/suppliers/actions";
import { createMaterialSchema } from "@/lib/validation/materials";
import {
  createSupplierSchema,
  type CreateSupplierInput,
} from "@/lib/validation/suppliers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type Material = { id: string; name: string };
type Supplier = { id: string; name: string };
type LineDraft = { rawMaterialId: string; percentage: string };

export function NewVersionDialog({
  open,
  onOpenChange,
  flavourId,
  flavourName,
  nextVersionNo,
  materials,
  suppliers,
  prefillWastagePct,
  prefillLines,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flavourId: string;
  flavourName: string;
  nextVersionNo: number;
  materials: Material[];
  suppliers: Supplier[];
  prefillWastagePct: number;
  prefillLines: { rawMaterialId: string; percentage: number }[];
}) {
  const router = useRouter();
  const [wastagePct, setWastagePct] = React.useState(String(prefillWastagePct));
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<LineDraft[]>(
    prefillLines.length > 0
      ? prefillLines.map((l) => ({
          rawMaterialId: l.rawMaterialId,
          percentage: String(l.percentage),
        }))
      : [{ rawMaterialId: "", percentage: "" }],
  );
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [localMaterials, setLocalMaterials] = React.useState(materials);
  const [newMaterialOpen, setNewMaterialOpen] = React.useState(false);

  React.useEffect(() => {
    // Only re-seed when the dialog transitions to open, not on every
    // `materials` prop change — creating a material/supplier inline calls
    // revalidatePath, which hands this dialog a fresh `materials` reference
    // while it's still open, and re-seeding then would blow away in-flight
    // edits to `lines`.
    if (open) setLocalMaterials(materials);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isFirstVersion = nextVersionNo === 1;

  const sum = lines.reduce(
    (acc, l) => acc + (parseFloat(l.percentage) || 0),
    0,
  );
  const materialIds = lines.map((l) => l.rawMaterialId).filter(Boolean);
  const hasDuplicates = new Set(materialIds).size !== materialIds.length;
  const allLinesValid = lines.every(
    (l) => l.rawMaterialId && parseFloat(l.percentage) > 0,
  );
  const canSave =
    Math.abs(sum - 100) < 0.001 &&
    note.trim().length > 0 &&
    lines.length > 0 &&
    allLinesValid &&
    !hasDuplicates;

  function reset() {
    setWastagePct(String(prefillWastagePct));
    setNote("");
    setLines(
      prefillLines.length > 0
        ? prefillLines.map((l) => ({
            rawMaterialId: l.rawMaterialId,
            percentage: String(l.percentage),
          }))
        : [{ rawMaterialId: "", percentage: "" }],
    );
    setServerError(null);
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, { rawMaterialId: "", percentage: "" }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function onMaterialCreated(material: Material) {
    setLocalMaterials((prev) => [...prev, material].sort((a, b) => a.name.localeCompare(b.name)));
    setLines((prev) => [
      ...prev.filter((l) => l.rawMaterialId || l.percentage),
      { rawMaterialId: material.id, percentage: "" },
    ]);
    setNewMaterialOpen(false);
    router.refresh();
  }

  async function handleSave() {
    if (!canSave) return;
    setServerError(null);
    setIsSubmitting(true);
    const result = await createRecipeVersion({
      flavourId,
      wastagePct: parseFloat(wastagePct) || 0,
      note: note.trim(),
      lines: lines.map((l) => ({
        rawMaterialId: l.rawMaterialId,
        percentage: parseFloat(l.percentage),
      })),
    });
    setIsSubmitting(false);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    reset();
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {flavourName} — change to v{nextVersionNo}
          </DialogTitle>
          <DialogDescription>
            This creates a new version; the current one is archived, never
            edited.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select
                  items={localMaterials.map((m) => ({ value: m.id, label: m.name }))}
                  value={line.rawMaterialId}
                  onValueChange={(v) =>
                    v && updateLine(index, { rawMaterialId: v })
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Material" />
                  </SelectTrigger>
                  <SelectContent>
                    {localMaterials.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative w-24 shrink-0">
                  <Input
                    type="number"
                    inputMode="decimal"
                    className="font-qty pr-6"
                    value={line.percentage}
                    onChange={(e) =>
                      updateLine(index, { percentage: e.target.value })
                    }
                  />
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">
                    %
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={lines.length <= 1}
                  onClick={() => removeLine(index)}
                  aria-label="Remove component"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLine}
                className="justify-self-start"
              >
                <Plus /> Add component
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNewMaterialOpen(true)}
              >
                <Plus /> New material
              </Button>
            </div>
            <p
              className={
                Math.abs(sum - 100) < 0.001
                  ? "text-primary font-qty text-sm"
                  : "text-destructive font-qty text-sm"
              }
            >
              Total: {sum}%{" "}
              {Math.abs(sum - 100) >= 0.001 && "(must total exactly 100%)"}
            </p>
            {hasDuplicates && (
              <p className="text-destructive text-sm">
                Each material can only appear once.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wastage-pct">Wastage %</Label>
            <Input
              id="wastage-pct"
              type="number"
              inputMode="decimal"
              step="0.1"
              className="font-qty w-28"
              value={wastagePct}
              onChange={(e) => setWastagePct(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="version-note">
              {isFirstVersion ? "Note" : "Reason for this change"}
            </Label>
            <Textarea
              id="version-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                isFirstVersion
                  ? "e.g. Initial recipe for launch"
                  : "e.g. Too minty at Nexa"
              }
            />
            <p className="text-muted-foreground text-xs">
              Every version keeps a note — there is no edit path, so this is
              the only record of why it exists.
            </p>
          </div>

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave || isSubmitting} onClick={handleSave}>
            {isSubmitting ? "Saving…" : `Save as v${nextVersionNo}`}
          </Button>
        </DialogFooter>
      </DialogContent>

      <NewMaterialDialog
        open={newMaterialOpen}
        onOpenChange={setNewMaterialOpen}
        suppliers={suppliers}
        onCreated={onMaterialCreated}
      />
    </Dialog>
  );
}

function NewMaterialDialog({
  open,
  onOpenChange,
  suppliers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  onCreated: (material: Material) => void;
}) {
  const [localSuppliers, setLocalSuppliers] = React.useState(suppliers);
  const [newSupplierOpen, setNewSupplierOpen] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  // Plain state rather than an RHF-registered field — this only ever needs
  // to drive the Select's display and get merged into the submit payload,
  // and a Controller-managed field wasn't reliably picking up the value set
  // by the nested "new supplier" dialog's onCreated callback.
  const [selectedSupplierId, setSelectedSupplierId] = React.useState<
    string | null
  >(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ name: string }>({
    resolver: zodResolver(createMaterialSchema.pick({ name: true })),
    defaultValues: { name: "" },
  });

  React.useEffect(() => {
    // Only re-seed/reset on the open transition — see the matching note in
    // NewVersionDialog. A `suppliers` (or `reset`) dependency here would
    // wipe the in-progress name/supplier selection the moment the nested
    // "new supplier" dialog's own revalidatePath refreshes this prop.
    if (open) {
      setLocalSuppliers(suppliers);
      setSelectedSupplierId(null);
      reset({ name: "" });
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(values: { name: string }) {
    setServerError(null);
    const result = await createMaterial({
      name: values.name,
      defaultSupplierId: selectedSupplierId,
    });
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    if (result.data) {
      onCreated({ id: result.data.id, name: values.name.trim() });
    }
  }

  function onSupplierCreated(supplier: Supplier) {
    setLocalSuppliers((prev) => [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedSupplierId(supplier.id);
    setNewSupplierOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New material</DialogTitle>
          <DialogDescription>
            Added straight to the raw materials list — it&apos;ll be ready to
            pick in this recipe right away.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="new-material-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="material-name">Name</Label>
            <Input id="material-name" autoFocus {...register("name")} />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Default supplier</Label>
            <div className="flex gap-2">
              <Select
                items={localSuppliers.map((s) => ({ value: s.id, label: s.name }))}
                value={selectedSupplierId ?? undefined}
                onValueChange={(v) => setSelectedSupplierId(v ?? null)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="None yet" />
                </SelectTrigger>
                <SelectContent>
                  {localSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewSupplierOpen(true)}
              >
                <Plus /> New supplier
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Optional — you can set this later from Setup.
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
          <Button type="submit" form="new-material-form" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add material"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <NewSupplierDialog
        open={newSupplierOpen}
        onOpenChange={setNewSupplierOpen}
        onCreated={onSupplierCreated}
      />
    </Dialog>
  );
}

function NewSupplierDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supplier: Supplier) => void;
}) {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateSupplierInput>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: {
      name: "",
      area: "",
      contactPerson: "",
      phone: "",
      gstin: "",
      notes: "",
    },
  });

  React.useEffect(() => {
    if (open) {
      reset({
        name: "",
        area: "",
        contactPerson: "",
        phone: "",
        gstin: "",
        notes: "",
      });
      setServerError(null);
    }
  }, [open, reset]);

  async function onSubmit(values: CreateSupplierInput) {
    setServerError(null);
    const result = await createSupplier(values);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    if (result.data) {
      onCreated({ id: result.data.id, name: values.name.trim() });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New supplier</DialogTitle>
          <DialogDescription>
            Just a name is enough to get going — add contact details later
            from Setup if you need them.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          id="new-supplier-form"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-name">Name</Label>
            <Input id="supplier-name" autoFocus {...register("name")} />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>
          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-supplier-form" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
