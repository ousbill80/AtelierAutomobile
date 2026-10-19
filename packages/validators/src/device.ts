import { z } from "zod";

export const registerSharedDeviceInputSchema = z.object({
  deviceId: z.string().trim().min(1),
  label: z.string().trim().min(1).max(120).optional(),
});
export type RegisterSharedDeviceInput = z.infer<typeof registerSharedDeviceInputSchema>;
