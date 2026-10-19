import { z } from "zod";
import { messageChannelSchema } from "./auth";
import { bayTypeSchema, openingHoursSchema } from "./site";
import { operatingModeSchema, taxRegimeSchema } from "./org";
import { roleSchema } from "./member";

const garageStepSchema = z.object({
  step: z.literal(2),
  data: z.object({
    name: z.string().trim().min(1),
    legalName: z.string().trim().min(1).optional(),
    commune: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1).optional(),
    taxRegime: taxRegimeSchema.optional(),
    vatEnabled: z.boolean().optional(),
    rccm: z.string().trim().min(1).optional(),
    ncc: z.string().trim().min(1).optional(),
    logoUrl: z.string().trim().min(1).optional(),
  }),
});

const workshopStepSchema = z.object({
  step: z.literal(3),
  data: z.object({
    name: z.string().trim().min(1),
    code: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .regex(/^[A-Z0-9]+$/, "Le code ne doit contenir que des lettres majuscules et des chiffres."),
    openingHours: openingHoursSchema.optional(),
    bays: z.array(z.object({ name: z.string().trim().min(1), type: bayTypeSchema })).optional(),
    hourlyRateFcfa: z.number().int().min(0).optional(),
  }),
});

const modeStepSchema = z.object({
  step: z.literal(4),
  data: z.object({ operatingMode: operatingModeSchema }),
});

// Étapes 5/6/7 facultatives (RG-M01-17) : `data` omis = « Plus tard » (étape marquée passée,
// sans effet de bord), `data` fourni = exécution normale de l'étape.

const teamStepSchema = z.object({
  step: z.literal(5),
  data: z
    .object({
      invitations: z.array(
        z
          .object({
            name: z.string().trim().min(2).max(120),
            phone: z.string().trim().min(1).optional(),
            email: z.string().trim().email().optional(),
            role: roleSchema,
            channel: messageChannelSchema,
          })
          .refine((v) => Boolean(v.phone) || Boolean(v.email), {
            message: "Un numéro de téléphone ou un email est requis.",
            path: ["phone"],
          }),
      ),
    })
    .optional(),
});

const channelsStepSchema = z.object({
  step: z.literal(6),
  data: z
    .object({
      whatsappProvider: z.enum(["wa_link", "whatsapp_cloud"]).default("wa_link"),
      smsEnabled: z.boolean().default(false),
      emailEnabled: z.boolean().default(false),
      sendTestTo: z.string().trim().min(1).optional(),
    })
    .optional(),
});

const dataStepSchema = z.object({
  step: z.literal(7),
  data: z.object({ choice: z.enum(["demo", "skip"]) }).optional(),
});

const doneStepSchema = z.object({
  step: z.literal(8),
  data: z.object({}).optional(),
});

export const saveOnboardingStepInputSchema = z.discriminatedUnion("step", [
  garageStepSchema,
  workshopStepSchema,
  modeStepSchema,
  teamStepSchema,
  channelsStepSchema,
  dataStepSchema,
  doneStepSchema,
]);
export type SaveOnboardingStepInput = z.infer<typeof saveOnboardingStepInputSchema>;
