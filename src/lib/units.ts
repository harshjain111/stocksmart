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
