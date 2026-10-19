import { z } from "zod";

export const fuelTypeSchema = z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "LPG", "OTHER"]);
export const transmissionSchema = z.enum(["MANUAL", "AUTOMATIC"]);
export const plateTypeSchema = z.enum([
  "STANDARD",
  "TEMPORARY",
  "DIPLOMATIC",
  "GOVERNMENT",
  "FOREIGN",
  "NONE",
  "OTHER",
]);
export const vehicleUsageSchema = z.enum([
  "PRIVATE",
  "TAXI",
  "TRANSPORT",
  "UTILITY",
  "RENTAL",
  "OTHER",
]);
export const mileageSourceSchema = z.enum(["RECEPTION", "IMPORT", "CUSTOMER", "MANUAL", "INVOICE"]);

/** Champs communs à la création/modification d'un véhicule (RG-M02-05, RG-M02-06). */
export const vehicleInputSchema = z.object({
  plate: z.string().trim().min(1),
  vin: z.string().trim().min(1).toUpperCase().nullable().optional(),
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  makeId: z.string().trim().min(1).nullable().optional(),
  modelId: z.string().trim().min(1).nullable().optional(),
  version: z.string().trim().min(1).nullable().optional(),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  firstRegistrationDate: z.coerce.date().nullable().optional(),
  fuel: fuelTypeSchema.nullable().optional(),
  transmission: transmissionSchema.nullable().optional(),
  engineCode: z.string().trim().min(1).nullable().optional(),
  color: z.string().trim().min(1).nullable().optional(),
  fleetNumber: z.string().trim().min(1).nullable().optional(),
  driverName: z.string().trim().min(1).nullable().optional(),
  driverPhone: z.string().trim().min(1).nullable().optional(),
  usage: vehicleUsageSchema.default("PRIVATE"),
  odometerInMiles: z.boolean().default(false),
  currentMileage: z.number().int().min(0).nullable().optional(),
  serviceIntervalKm: z.number().int().positive().nullable().optional(),
  serviceIntervalMonths: z.number().int().positive().nullable().optional(),
  insuranceCompanyId: z.string().trim().min(1).nullable().optional(),
  insuranceExpiryDate: z.coerce.date().nullable().optional(),
  insurancePolicyNumber: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
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
  limit: z.number().int().min(1).max(100).default(25),
});
export type VehicleListInput = z.infer<typeof vehicleListInputSchema>;

export const vehicleGetInputSchema = z.object({ id: z.string().trim().min(1) });
export type VehicleGetInput = z.infer<typeof vehicleGetInputSchema>;

export const vehicleCreateInputSchema = vehicleInputSchema.extend({
  customerId: z.string().trim().min(1),
});
export type VehicleCreateInput = z.infer<typeof vehicleCreateInputSchema>;

export const vehicleBulkCreateInputSchema = z.object({
  customerId: z.string().trim().min(1),
  vehicles: z.array(vehicleInputSchema).min(1).max(50),
});
export type VehicleBulkCreateInput = z.infer<typeof vehicleBulkCreateInputSchema>;

export const vehicleUpdateInputSchema = z.object({
  id: z.string().trim().min(1),
  patch: vehicleInputSchema.partial(),
});
export type VehicleUpdateInput = z.infer<typeof vehicleUpdateInputSchema>;

export const recordMileageInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  mileage: z.number().int().min(0),
  readAt: z.coerce.date(),
  source: mileageSourceSchema,
  repairOrderId: z.string().trim().min(1).optional(),
  odometerReset: z.boolean().default(false),
  confirmHighRate: z.boolean().default(false),
});
export type RecordMileageInput = z.infer<typeof recordMileageInputSchema>;

export const recordInspectionInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  date: z.coerce.date(),
  expiryDate: z.coerce.date().nullable().optional(),
  center: z.string().trim().min(1).nullable().optional(),
});
export type RecordInspectionInput = z.infer<typeof recordInspectionInputSchema>;

export const recordServiceInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  date: z.coerce.date(),
  mileage: z.number().int().min(0),
  repairOrderId: z.string().trim().min(1).optional(),
});
export type RecordServiceInput = z.infer<typeof recordServiceInputSchema>;

export const transferOwnerInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  toCustomerId: z.string().trim().min(1),
  effectiveDate: z.coerce.date(),
  note: z.string().trim().min(1).nullable().optional(),
});
export type TransferOwnerInput = z.infer<typeof transferOwnerInputSchema>;

export const replacePlateInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  newPlate: z.string().trim().min(1),
  plateType: plateTypeSchema.optional(),
});
export type ReplacePlateInput = z.infer<typeof replacePlateInputSchema>;

export const vehicleMergeInputSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
});
export type VehicleMergeInput = z.infer<typeof vehicleMergeInputSchema>;

export const vehicleDeleteInputSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});
export type VehicleDeleteInput = z.infer<typeof vehicleDeleteInputSchema>;
