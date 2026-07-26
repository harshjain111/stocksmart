import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  area: z.string().trim(),
  contactPerson: z.string().trim(),
  phone: z.string().trim(),
  gstin: z.string().trim(),
  notes: z.string().trim(),
});

export const updateSupplierSchema = createSupplierSchema.extend({
  id: z.uuid(),
});

export const archiveSupplierSchema = z.object({
  id: z.uuid(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
