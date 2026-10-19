import { TRPCError } from "@trpc/server";
import { isDomainError, renderTemplate, smsSegments } from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  templateListInputSchema,
  templatePreviewInputSchema,
  templateUpsertInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

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

      const warnings: string[] = [];
      let rendered = "";
      try {
        rendered = renderTemplate({
          template: body,
          context: input.context,
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
      if (sms && sms.segments > 1) {
        warnings.push(`${sms.segments} segments SMS.`);
      }

      return { rendered, sms, warnings };
    }),
});
