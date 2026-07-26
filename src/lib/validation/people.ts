import { z } from "zod";

export const userRoleSchema = z.enum([
  "admin",
  "branch_manager",
  "store_manager",
  "purchase_manager",
  "hod",
  "senior_mixer",
  "mixer",
]);

export const inviteUserSchema = z.object({
  email: z.email("Enter a valid email"),
  fullName: z.string().trim().min(1, "Name is required"),
  role: userRoleSchema,
  branchId: z.uuid(),
  departmentIds: z.array(z.uuid()),
});

export const updateUserSchema = z.object({
  id: z.uuid(),
  role: userRoleSchema,
  branchId: z.uuid(),
  departmentIds: z.array(z.uuid()),
});

export const deactivateUserSchema = z.object({
  id: z.uuid(),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
