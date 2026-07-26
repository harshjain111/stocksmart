"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { createRecipeVersion } from "@/app/(app)/recipes/actions";
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
type LineDraft = { rawMaterialId: string; percentage: string };

export function NewVersionDialog({
  open,
  onOpenChange,
  flavourId,
  flavourName,
  nextVersionNo,
  materials,
  prefillWastagePct,
  prefillLines,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flavourId: string;
  flavourName: string;
  nextVersionNo: number;
  materials: Material[];
  prefillWastagePct: number;
  prefillLines: { rawMaterialId: string; percentage: number }[];
}) {
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
                  items={materials.map((m) => ({ value: m.id, label: m.name }))}
                  value={line.rawMaterialId}
                  onValueChange={(v) =>
                    v && updateLine(index, { rawMaterialId: v })
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Material" />
                  </SelectTrigger>
                  <SelectContent>
                    {materials.map((m) => (
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLine}
              className="justify-self-start"
            >
              <Plus /> Add component
            </Button>
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
            <Label htmlFor="version-note">Reason for this change</Label>
            <Textarea
              id="version-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Too minty at Nexa"
            />
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
    </Dialog>
  );
}
