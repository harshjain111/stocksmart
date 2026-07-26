"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type QtyInputProps = {
  id?: string;
  label?: string;
  value: number | null;
  onChange: (grams: number | null) => void;
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  allowNegative?: boolean;
  className?: string;
  error?: string;
};

// All quantities are grams, stored as integers — this is the only input
// widget allowed to collect a quantity, so the integer + unit rule lives
// in one place instead of every form re-implementing it.
export function QtyInput({
  id,
  label,
  value,
  onChange,
  unit = "g",
  placeholder,
  disabled,
  required,
  allowNegative = false,
  className,
  error,
}: QtyInputProps) {
  const [raw, setRaw] = React.useState(
    value === null || value === undefined ? "" : String(value),
  );

  React.useEffect(() => {
    setRaw(value === null || value === undefined ? "" : String(value));
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    const pattern = allowNegative ? /^-?\d*$/ : /^\d*$/;
    if (!pattern.test(next)) return;
    setRaw(next);

    if (next === "" || next === "-") {
      onChange(null);
      return;
    }
    onChange(parseInt(next, 10));
  }

  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
      )}
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          value={raw}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={!!error}
          className="font-qty pr-10"
        />
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
          {unit}
        </span>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
