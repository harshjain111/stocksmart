import { z } from "zod";

export const createDraftBatchSchema = z.object({
  flavourId: z.uuid(),
  recipeVersionId: z.uuid(),
  departmentId: z.uuid(),
  outputG: z.coerce.number().int().positive("Enter an output quantity"),
});

export type CreateDraftBatchInput = z.infer<typeof createDraftBatchSchema>;
