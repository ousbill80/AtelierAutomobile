import {
  assertStartValueIncrease,
  DEFAULT_NUMBERING_CONFIG,
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

export const numberingRouter = router({
  get: requirePermission("settings:read").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
    });
    const stored = readNumberingSettings(org.settings);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const year = new Date().getFullYear();

    return Promise.all(
      DOCUMENT_TYPES.map(async (docType) => {
        const config = resolveConfig(docType, stored);
        const sequences = await tenantDb.documentSequence.findMany({
          where: { docType, year },
        });
        const lastValue = sequences.reduce((max, seq) => Math.max(max, seq.lastValue), 0);
        const nextPreview = renderNumberingPattern(config, {
          year,
          value: lastValue + 1,
          siteCode: config.perSite ? "XXX" : null,
        });
        return { docType, config, nextPreview };
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
      const year = new Date().getFullYear();

      if (input.startAt !== undefined) {
        const sequences = await tenantDb.documentSequence.findMany({
          where: { docType: input.docType, year },
        });
        for (const seq of sequences) {
          withDomainErrors(() => assertStartValueIncrease(seq.lastValue, input.startAt!));
        }
        await Promise.all(
          sequences.map((seq) =>
            tenantDb.documentSequence.update({
              where: { id: seq.id },
              data: { lastValue: input.startAt! - 1 },
            }),
          ),
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
        after: { numbering: nextSettings.numbering },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      const nextStored = readNumberingSettings(updatedOrg.settings);
      const config = resolveConfig(input.docType, nextStored);
      const sequences = await tenantDb.documentSequence.findMany({
        where: { docType: input.docType, year },
      });
      const lastValue = sequences.reduce((max, seq) => Math.max(max, seq.lastValue), 0);
      const nextPreview = renderNumberingPattern(config, {
        year,
        value: lastValue + 1,
        siteCode: config.perSite ? "XXX" : null,
      });

      return { docType: input.docType, config, nextPreview };
    }),
});
