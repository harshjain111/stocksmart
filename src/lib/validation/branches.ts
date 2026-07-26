import { z } from "zod";

export const departmentTypeSchema = z.enum([
  "godown",
  "office",
  "club",
  "cafe",
]);

export const createBranchSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  isHq: z.boolean(),
});

export const createDepartmentSchema = z.object({
  branchId: z.uuid(),
  name: z.string().trim().min(1, "Name is required"),
  type: departmentTypeSchema,
  holdsRaw: z.boolean(),
  holdsMixed: z.boolean(),
  canMix: z.boolean(),
  hodId: z.uuid().nullable(),
});

export const updateDepartmentSchema = createDepartmentSchema.extend({
  id: z.uuid(),
});

export const archiveDepartmentSchema = z.object({
  id: z.uuid(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
