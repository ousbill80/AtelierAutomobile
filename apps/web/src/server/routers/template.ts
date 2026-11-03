import { TRPCError } from "@trpc/server";
import {
  addDays,
  formatDate,
  formatFCFA,
  garageNamespace,
  isDomainError,
  renderTemplate,
  smsSegments,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  templateListInputSchema,
  templatePreviewInputSchema,
  templateUpsertInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

/**
 * Contexte de démonstration de l'aperçu : toutes les variables des modèles livrés
 * (onboarding/reminder-defaults) ont une valeur réaliste, pour que l'aperçu s'affiche
 * toujours. Seul le garage est celui de l'organisation ; le reste est fictif.
 */
function sampleContext(
  org: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
  },
  timeZone: string,
  now: Date,
): Record<string, unknown> {
  const day = (offset: number) => formatDate(addDays(now, offset), timeZone);
  const base = "https://atelieros.ci";
  const garage = garageNamespace(org);
  return {
    timeZone,
    garage: {
      ...garage,
      telephone: garage.telephone || "+225 07 00 00 00 00",
      adresse: garage.adresse || "Boulevard VGE, Abidjan",
    },
    client: {
      salutation: "M. Kouassi",
      nomComplet: "Jean Kouassi",
      soldeEnRetard: formatFCFA(185_000),
      joursRetardMax: "15",
    },
    vehicule: {
      marque: "Toyota",
      modele: "Corolla",
      plaque: "1234 AB 01",
      kmEstime: "85 000 km",
    },
    vehicules: { nombre: "2", liste: "Toyota Corolla (1234 AB 01), Kia Picanto (5678 CD 01)" },
    vt: { dateExpiration: day(30), joursRestants: "30" },
    revision: { dateEcheance: day(15), kmEcheance: "90 000 km" },
    assurance: { dateExpiration: day(20) },
    rdv: { date: day(2), heure: "09:00" },
    devis: {
      numero: "DEV-2026-0042",
      montant: formatFCFA(185_000),
      validite: day(30),
    },
    facture: {
      numero: "FAC-2026-0128",
      solde: formatFCFA(185_000),
      echeance: day(-15),
    },
    factures: {
      resume: `2 facture(s), ${formatFCFA(245_000)}`,
      detail: `FAC-2026-0128 : ${formatFCFA(185_000)} ; FAC-2026-0131 : ${formatFCFA(60_000)}`,
    },
    promesse: { date: day(7), montant: formatFCFA(100_000) },
    espace: { nom: "Mon espace client" },
    lien: {
      paiement: `${base}/p/demo`,
      devis: `${base}/d/demo`,
      facture: `${base}/f/demo`,
      releve: `${base}/r/demo`,
      rdv: `${base}/rdv/demo`,
      avis: `${base}/avis/demo`,
    },
  };
}

function mergeContext(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object"
        ? mergeContext(current as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return result;
}

export const templateRouter = router({
  list: requirePermission("message:read")
    .input(templateListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.messageTemplate.findMany({
        where: input.channel ? { channel: input.channel } : {},
        orderBy: { key: "asc" },
      });
    }),

  upsert: requirePermission("template:manage")
    .input(templateUpsertInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      if (input.id) {
        return tenantDb.messageTemplate.update({
          where: { id: input.id },
          data: {
            name: input.name,
            subject: input.subject,
            body: input.body,
            isActive: input.isActive,
            isDefault: false, // RG-M11-05 §14 : toute modification quitte le modèle livré par défaut
          },
        });
      }
      return tenantDb.messageTemplate.create({
        data: {
          organizationId: ctx.organizationId,
          key: input.key,
          name: input.name,
          channel: input.channel,
          subject: input.subject,
          body: input.body,
          isActive: input.isActive,
          isDefault: false,
        },
      });
    }),

  preview: requirePermission("template:manage")
    .input(templatePreviewInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      let body = input.body;
      if (!body && input.key) {
        const template = await tenantDb.messageTemplate.findFirst({
          where: { key: input.key, channel: input.channel },
        });
        if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Modèle introuvable." });
        body = template.body;
      }
      if (!body) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Un corps ou une clé de modèle est requis.",
        });
      }

      const org = await adminDb.organization.findUnique({ where: { id: ctx.organizationId } });
      const context = mergeContext(
        sampleContext(org ?? {}, org?.timezone ?? "Africa/Abidjan", new Date()),
        input.context,
      );

      const warnings: string[] = [];
      let rendered = "";
      try {
        rendered = renderTemplate({
          template: body,
          context,
          channel: input.channel,
        }).body;
      } catch (error) {
        if (isDomainError(error)) {
          warnings.push(error.message);
        } else {
          throw error;
        }
      }

      const sms = input.channel === "SMS" && rendered ? smsSegments(rendered) : null;
      if (sms && sms.encoding === "UCS2") {
        warnings.push(
          `Caractères non GSM-7 : ${sms.nonGsmChars.join(" ")} (translitération recommandée).`,
        );
      }

      return { rendered, sms, warnings };
    }),
});
