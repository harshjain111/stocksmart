// All quantities are stored as integer grams (CLAUDE.md rule 1). Conversion
// to kg happens only here, at display — never propagated back into a stored
// value.

export function formatGrams(grams: number): string {
  if (Math.abs(grams) < 1000) return `${grams} g`;
  const kg = Math.round((grams / 1000) * 1000) / 1000;
  return `${kg} kg`;
}

export function kgToGrams(kg: number): number {
  return Math.round(kg * 1000);
}

/**
 * Short form for dashboard tiles, where three decimals of a kilogram is
 * noise that pushes the number onto a second line. Full precision stays
 * in the tables, which is where anyone actually reads a figure.
 */
export function formatQtyCompact(grams: number): string {
  if (Math.abs(grams) < 1000) return `${grams} g`;
  const kg = grams / 1000;
  if (Math.abs(kg) >= 100) return `${Math.round(kg)} kg`;
  return `${Number(kg.toFixed(1))} kg`;
}
