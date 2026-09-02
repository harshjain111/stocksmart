import { z } from "zod";

export const createFlavourSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  // Optional so callers that only know a name (e.g. the quick-create
  // dialog on the Recipes screen) keep working — the supplier mapping can
  // be set later from Setup, and Purchases warns on unmapped flavours.
  defaultSupplierId: z.uuid().nullable().optional(),
});

export const updateFlavourSchema = createFlavourSchema.extend({
  id: z.uuid(),
});

export type CreateFlavourInput = z.infer<typeof createFlavourSchema>;
export type UpdateFlavourInput = z.infer<typeof updateFlavourSchema>;
