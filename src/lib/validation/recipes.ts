import { z } from "zod";

export const recipeLineSchema = z.object({
  rawMaterialId: z.uuid(),
  percentage: z.coerce.number().positive("Must be greater than 0"),
});

export const createRecipeVersionSchema = z.object({
  flavourId: z.uuid(),
  wastagePct: z.coerce.number().min(0).max(100),
  note: z.string().trim().min(1, "A reason note is required"),
  lines: z
    .array(recipeLineSchema)
    .min(1, "At least one component is required")
    .refine(
      (lines) =>
        new Set(lines.map((l) => l.rawMaterialId)).size === lines.length,
      "Each material can only appear once",
    ),
});

export type CreateRecipeVersionInput = z.infer<
  typeof createRecipeVersionSchema
>;
