import { z } from "zod";

export const createFlavourSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
});

export const updateFlavourSchema = createFlavourSchema.extend({
  id: z.uuid(),
});

export type CreateFlavourInput = z.infer<typeof createFlavourSchema>;
export type UpdateFlavourInput = z.infer<typeof updateFlavourSchema>;
