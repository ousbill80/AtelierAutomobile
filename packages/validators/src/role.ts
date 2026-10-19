import { z } from "zod";
import { roleSchema } from "./member";

export const getRoleMatrixInputSchema = z.object({}).optional();
export type GetRoleMatrixInput = z.infer<typeof getRoleMatrixInputSchema>;

export const updateRolePermissionsInputSchema = z.object({
  role: roleSchema,
  permissions: z.array(z.string().trim().min(1)),
});
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsInputSchema>;

export const resetRoleDefaultsInputSchema = z.object({
  role: roleSchema,
});
export type ResetRoleDefaultsInput = z.infer<typeof resetRoleDefaultsInputSchema>;
