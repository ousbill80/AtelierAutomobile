import {
  assertStartValueIncrease,
  businessDate,
  DEFAULT_NUMBERING_CONFIG,
  isFiscalDocumentType,
  renderNumberingPattern,
  validateNumberingConfig,
  type DocumentType,
  type NumberingConfig,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { documentTypeSchema, updateNumberingInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";
import { withDomainErrors } from "../domain-error";

// RG-M15-06/RG-M15-12 — numérotation configurable, stockée dans `Organization.settings.numbering`
// (clé = DocumentType). Lecture `settings:read`, écriture `settings:update` (M15 §10).

const DOCUMENT_TYPES = documentTypeSchema.options;

type NumberingSettings = Partial<Record<DocumentType, Partial<NumberingConfig>>>;

function readNumberingSettings(settings: unknown): NumberingSettings {
  if (settings && typeof settings === "object" && "numbering" in settings) {
    const numbering = (settings as { numbering?: unknown }).numbering;
    if (numbering && typeof numbering === "object") {
      return numbering as NumberingSettings;
    }
  }
  return {};
}

function resolveConfig(docType: DocumentType, stored: NumberingSettings): NumberingConfig {
  return { ...DEFAULT_NUMBERING_CONFIG[docType], ...stored[docType] };
}

type TenantDb = ReturnType<typeof db.forTenant>;

/** Année métier courante dans le fuseau de l'organisation, comme les générateurs de numéros. */
function currentBusinessPeriod(timeZone: string): { year: number; month: number } {
  const day = businessDate(new Date(), timeZone);
  return { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1 };
}

/**
 * Clé de séquence telle que la calculent les générateurs (repairOrders/helpers, quotes/service,
 * claims/service, stock/context, billing/service) : `year = 0` sans remise à zéro annuelle,
 * `siteId` renseigné seulement pour un document opérationnel numéroté par site (A4).
 */
function sequenceScope(docType: DocumentType, config: NumberingConfig, year: number) {
  return {
    perSite: config.perSite && !isFiscalDocumentType(docType),
    year: config.resetYearly ? year : 0,
  };
}

/** Plus grande valeur déjà émise pour la portée courante (toutes les séquences de site). */
async function lastIssuedValue(
  tenantDb: TenantDb,
  docType: DocumentType,
  config: NumberingConfig,
  year: number,
): Promise<number> {
  const scope = sequenceScope(docType, config, year);
  const sequences = await tenantDb.documentSequence.findMany({
    where: { docType, year: scope.year, siteId: scope.perSite ? { not: null } : null },
    select: { lastValue: true },
  });
  return sequences.reduce((max, seq) => Math.max(max, seq.lastValue), 0);
}

async function previewFor(
  tenantDb: TenantDb,
  docType: DocumentType,
  config: NumberingConfig,
  period: { year: number; month: number },
) {
  const lastValue = await lastIssuedValue(tenantDb, docType, config, period.year);
  const nextValue = lastValue + 1;
  const nextPreview = renderNumberingPattern(config, {
    year: period.year,
    month: period.month,
    value: nextValue,
    siteCode: config.perSite ? "XXX" : null,
  });
  return { nextValue, nextPreview };
}

/**
 * RG-M15-06 — fixe la valeur de départ (prochain numéro = `startAt`) de chaque séquence de la
 * portée, en la créant au besoin. Refus si un numéro ≥ `startAt` a déjà été émis (pas de doublon).
 * La mise à jour est conditionnelle (`lastValue < startAt`) : une émission concurrente ne peut pas
 * être écrasée.
 */
async function applyStartAt(
  tenantDb: TenantDb,
  organizationId: string,
  docType: DocumentType,
  config: NumberingConfig,
  year: number,
  startAt: number,
): Promise<void> {
  const scope = sequenceScope(docType, config, year);
  const siteIds: (string | null)[] = scope.perSite
    ? (await tenantDb.site.findMany({ select: { id: true } })).map((site) => site.id)
    : [null];

  const existing = await tenantDb.documentSequence.findMany({
    where: {
      docType,
      year: scope.year,
      siteId: scope.perSite ? { in: siteIds as string[] } : null,
    },
  });
  for (const seq of existing) {
    withDomainErrors(() => assertStartValueIncrease(seq.lastValue, startAt));
  }

  for (const siteId of siteIds) {
    const where = { docType, year: scope.year, siteId };
    const found = existing.find((seq) => seq.siteId === siteId);
    if (!found) {
      await tenantDb.documentSequence.createMany({
        data: [{ organizationId, siteId, docType, year: scope.year, lastValue: 0 }],
        skipDuplicates: true,
      });
    }
    const { count } = await tenantDb.documentSequence.updateMany({
      where: { ...where, lastValue: { lt: startAt } },
      data: { lastValue: startAt - 1 },
    });
    if (count !== 1) {
      // Un numéro a été émis entre la vérification et l'écriture : on relit pour le message.
      const current = await tenantDb.documentSequence.findFirst({ where });
      withDomainErrors(() => assertStartValueIncrease(current?.lastValue ?? startAt, startAt));
    }
  }
}

export const numberingRouter = router({
  get: requirePermission("settings:read").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
    });
    const stored = readNumberingSettings(org.settings);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const period = currentBusinessPeriod(org.timezone);

    return Promise.all(
      DOCUMENT_TYPES.map(async (docType) => {
        const config = resolveConfig(docType, stored);
        return { docType, config, ...(await previewFor(tenantDb, docType, config, period)) };
      }),
    );
  }),

  update: requirePermission("settings:update")
    .input(updateNumberingInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const stored = readNumberingSettings(org.settings);

      const nextConfig: NumberingConfig = {
        prefix: input.prefix,
        pattern: input.pattern,
        padding: input.padding,
        perSite: input.perSite,
        resetYearly: input.resetYearly,
      };
      withDomainErrors(() => validateNumberingConfig(input.docType, nextConfig));

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const period = currentBusinessPeriod(org.timezone);

      if (input.startAt !== undefined) {
        await applyStartAt(
          tenantDb,
          ctx.organizationId,
          input.docType,
          nextConfig,
          period.year,
          input.startAt,
        );
      }

      const nextSettings = {
        ...(typeof org.settings === "object" && org.settings ? org.settings : {}),
        numbering: { ...stored, [input.docType]: nextConfig },
      };

      const updatedOrg = await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: nextSettings },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "numbering.updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before: { numbering: stored },
        after: {
          numbering: nextSettings.numbering,
          ...(input.startAt !== undefined ? { startAt: { [input.docType]: input.startAt } } : {}),
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      const nextStored = readNumberingSettings(updatedOrg.settings);
      const config = resolveConfig(input.docType, nextStored);
      return {
        docType: input.docType,
        config,
        ...(await previewFor(tenantDb, input.docType, config, period)),
      };
    }),
});
