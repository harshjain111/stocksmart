import { z } from "zod";

export const createMaterialSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  defaultSupplierId: z.uuid().nullable(),
});

export const updateMaterialSchema = createMaterialSchema.extend({
  id: z.uuid(),
});

export const addSupplierRateSchema = z.object({
  rawMaterialId: z.uuid(),
  supplierId: z.uuid(),
  rate: z.coerce.number().positive("Rate must be greater than 0"),
});

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
export type AddSupplierRateInput = z.infer<typeof addSupplierRateSchema>;
