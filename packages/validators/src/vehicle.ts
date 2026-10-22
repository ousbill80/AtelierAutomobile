import { z } from "zod";

export const vehicleUsageSchema = z.enum([
  "PRIVATE",
  "TAXI",
  "TRANSPORT",
  "UTILITY",
  "RENTAL",
  "OTHER",
]);
export const plateTypeSchema = z.enum([
  "STANDARD",
  "TEMPORARY",
  "DIPLOMATIC",
  "GOVERNMENT",
  "FOREIGN",
  "NONE",
  "OTHER",
]);
export const fuelTypeSchema = z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "LPG", "OTHER"]);
export const transmissionSchema = z.enum(["MANUAL", "AUTOMATIC"]);
export const mileageSourceSchema = z.enum(["RECEPTION", "IMPORT", "CUSTOMER", "MANUAL", "INVOICE"]);

export const vehicleInputSchema = z.object({
  customerId: z.string().trim().min(1),
  plate: z.string().trim().min(1),
  plateType: plateTypeSchema.optional(),
  usage: vehicleUsageSchema.optional(),
  vin: z.string().trim().min(1).optional(),
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  makeId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  year: z.number().int().optional(),
  firstRegistrationDate: z.coerce.date().optional(),
  fuel: fuelTypeSchema.optional(),
  transmission: transmissionSchema.optional(),
  engineCode: z.string().trim().min(1).optional(),
  color: z.string().trim().min(1).optional(),
  fleetNumber: z.string().trim().min(1).optional(),
  driverName: z.string().trim().min(1).optional(),
  driverPhone: z.string().trim().min(1).optional(),
  serviceIntervalKm: z.number().int().positive().optional(),
  serviceIntervalMonths: z.number().int().positive().optional(),
  odometerInMiles: z.boolean().optional(),
});
export type VehicleInput = z.infer<typeof vehicleInputSchema>;

export const vehicleListInputSchema = z.object({
  q: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  inspectionStatus: z.enum(["UNKNOWN", "OK", "DUE_SOON", "EXPIRED"]).optional(),
  serviceStatus: z.enum(["UNKNOWN", "OK", "DUE_SOON", "OVERDUE"]).optional(),
  make: z.string().trim().min(1).optional(),
  usage: vehicleUsageSchema.optional(),
  plateType: plateTypeSchema.optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type VehicleListInput = z.infer<typeof vehicleListInputSchema>;

export const vehicleGetInputSchema = z.object({ id: z.string().trim().min(1) });

export const bulkCreateVehiclesInputSchema = z.object({
  customerId: z.string().trim().min(1),
  vehicles: z
    .array(vehicleInputSchema.omit({ customerId: true }))
    .min(1)
    .max(50),
});
export type BulkCreateVehiclesInput = z.infer<typeof bulkCreateVehiclesInputSchema>;

export const updateVehicleInputSchema = z.object({
  id: z.string().trim().min(1),
  patch: vehicleInputSchema.omit({ customerId: true, plate: true }).partial(),
});

/** M16 — rattachement du véhicule à une compagnie d'assurance et à une police (null = retirer). */
export const setVehicleInsuranceInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  insuranceCompanyId: z.string().trim().min(1).nullable(),
  policyNumber: z.string().trim().max(60).nullable(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide : utilisez le format AAAA-MM-JJ.")
    .nullable(),
});
export type SetVehicleInsuranceInput = z.infer<typeof setVehicleInsuranceInputSchema>;

export const recordMileageInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  mileage: z.number().int().min(0),
  readAt: z.coerce.date(),
  source: mileageSourceSchema,
  odometerReset: z.boolean().optional(),
  confirmHighRate: z.boolean().optional(),
});
export type RecordMileageInput = z.infer<typeof recordMileageInputSchema>;

export const recordInspectionInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  date: z.coerce.date(),
  expiryDate: z.coerce.date().optional(),
  center: z.string().trim().min(1).optional(),
});
export type RecordInspectionInput = z.infer<typeof recordInspectionInputSchema>;

export const recordServiceInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  date: z.coerce.date(),
  mileage: z.number().int().min(0),
  repairOrderId: z.string().trim().min(1).optional(),
});

export const transferOwnerInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  toCustomerId: z.string().trim().min(1),
  effectiveDate: z.coerce.date(),
  note: z.string().trim().min(1).optional(),
});
export type TransferOwnerInput = z.infer<typeof transferOwnerInputSchema>;

export const replacePlateInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  newPlate: z.string().trim().min(1),
  plateType: plateTypeSchema,
});

export const mergeVehicleInputSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
});

export const deleteVehicleInputSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});
