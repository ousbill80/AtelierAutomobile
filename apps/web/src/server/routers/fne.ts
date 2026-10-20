// M08 §8 / M15 §8 — routeur `fne` : configuration par organisation (mode, adaptateur, identifiants
// DGI chiffrés, jamais renvoyés ni journalisés), test de la connexion, réessai d'une
// certification et saisie manuelle du numéro / QR code FNE (RG-M08-15 à 17, RG-M15-18).
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  assertCanRetryFne,
  assertFneConfigChange,
  validateManualFne,
  type FneModeValue,
} from "@atelieros/core";
import { certifyInvoiceFne, db } from "@atelieros/db";
import { encryptSecret, loadEncryptionKey } from "@atelieros/integrations";
import {
  fneConfigUpdateInputSchema,
  fneInvoiceInputSchema,
  fneSetManualInputSchema,
} from "@atelieros/validators";
import { actorOf } from "../billing/context";
import { fneCertifierFor } from "../billing/fneProvider";
import {
  audit,
  billingNow,
  guard,
  invoiceNotFound,
  loadOrgBillingContext,
} from "../billing/service";
import { emitDomainEvent } from "../events/emit";
import { getAttachmentStorage } from "../storage";
import { requirePermission, requireSite, router } from "../trpc";

const UNCERTIFIED = ["PENDING", "FAILED"] as const;

function modeOf(value: string | null | undefined): FneModeValue {
  return value === "api" || value === "disabled" ? value : "manual";
}

export const fneRouter = router({
  /** `/parametres/fne` : configuration sans aucun secret + état des dernières certifications. */
  getConfig: requirePermission("settings:fne").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const [org, config, counts, recent] = await Promise.all([
      loadOrgBillingContext(ctx.organizationId),
      tenantDb.fneConfig.findFirst({}),
      tenantDb.invoice.groupBy({
        by: ["fneStatus"],
        where: { status: { not: "DRAFT" } },
        _count: { _all: true },
      }),
      tenantDb.invoice.findMany({
        where: { status: { not: "DRAFT" }, fneStatus: { not: "NOT_REQUIRED" } },
        orderBy: { issuedAt: "desc" },
        take: 10,
        select: {
          id: true,
          number: true,
          type: true,
          fneStatus: true,
          fneNumber: true,
          fneCertifiedAt: true,
          fneError: true,
          issuedAt: true,
        },
      }),
    ]);
    return {
      mode: modeOf(config?.mode),
      provider: config?.provider ?? "dgi_api",
      establishmentId: config?.establishmentId ?? null,
      pointOfSale: config?.pointOfSale ?? null,
      hasCredentials: !!config?.credentials,
      lastTestedAt: config?.lastTestedAt ?? null,
      lastTestOk: config?.lastTestOk ?? null,
      lastError: config?.lastError ?? null,
      simulatorAllowed: process.env.APP_ENV !== "production",
      timeZone: org.timeZone,
      counts: Object.fromEntries(counts.map((c) => [c.fneStatus, c._count._all])) as Record<
        string,
        number
      >,
      recent,
    };
  }),

  updateConfig: requirePermission("settings:fne")
    .input(fneConfigUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.fneConfig.findFirst({});
      const from = existing ? modeOf(existing.mode) : null;
      if (input.provider === "fake" && process.env.APP_ENV === "production") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Le simulateur FNE est interdit en production : renseignez les identifiants DGI.",
        });
      }
      guard(() =>
        assertFneConfigChange({
          from,
          to: input.mode,
          reason: input.reason,
          hasCredentials:
            input.provider === "fake" || !!input.credentials || !!existing?.credentials,
        }),
      );
      const credentials = input.credentials
        ? encryptSecret(JSON.stringify(input.credentials), loadEncryptionKey())
        : undefined;
      const data = {
        mode: input.mode,
        provider: input.provider,
        establishmentId: input.establishmentId || null,
        pointOfSale: input.pointOfSale || null,
        isActive: input.mode !== "disabled",
        ...(credentials
          ? { credentials, lastTestedAt: null, lastTestOk: null, lastError: null }
          : {}),
      };
      const saved = existing
        ? await tenantDb.fneConfig.update({ where: { id: existing.id }, data })
        : await tenantDb.fneConfig.create({
            data: { organizationId: ctx.organizationId, ...data },
          });
      if (input.mode === "api" && from !== "api") {
        // Bascule manuel → API : les factures encore en attente sont soumises au prochain balayage.
        await tenantDb.invoice.updateMany({
          where: { status: { not: "DRAFT" }, fneStatus: "PENDING", fneNextRetryAt: null },
          data: { fneNextRetryAt: billingNow() },
        });
      }
      const view = (c: typeof existing) =>
        c
          ? {
              mode: c.mode,
              provider: c.provider,
              establishmentId: c.establishmentId,
              pointOfSale: c.pointOfSale,
            }
          : null;
      // RG-M15-25 : valeurs secrètes remplacées par « [secret modifié] ».
      await audit(actorOf(ctx), "fne_config.updated", "FneConfig", saved.id, {
        before: view(existing),
        after: { ...view(saved), ...(credentials ? { credentials: "[secret modifié]" } : {}) },
        reason: input.reason || null,
      });
      return { ok: true, mode: modeOf(saved.mode) };
    }),

  /** « Tester la certification » (RG-M15-18) : test d'authentification, sans facture réelle. */
  test: requirePermission("settings:fne").mutation(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const config = await tenantDb.fneConfig.findFirst({});
    let health: { ok: boolean; detail: string };
    try {
      const provider = await fneCertifierFor(ctx.organizationId);
      health = (await (
        provider as { healthCheck?: () => Promise<{ ok: boolean; detail: string }> }
      ).healthCheck?.()) ?? { ok: true, detail: "Aucun test disponible pour ce mode." };
    } catch (error) {
      health = { ok: false, detail: error instanceof Error ? error.message : "Échec du test." };
    }
    if (config) {
      await tenantDb.fneConfig.update({
        where: { id: config.id },
        data: {
          lastTestedAt: billingNow(),
          lastTestOk: health.ok,
          lastError: health.ok ? null : health.detail.slice(0, 500),
        },
      });
    }
    return health;
  }),

  /** Bouton « Réessayer » : tentative immédiate (mode API), même règles que le job `fne.certify`. */
  retry: requirePermission("fne:manage")
    .input(fneInvoiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const [invoice, config] = await Promise.all([
        tenantDb.invoice.findFirst({ where: { id: input.invoiceId } }),
        tenantDb.fneConfig.findFirst({}),
      ]);
      if (!invoice) invoiceNotFound();
      requireSite(ctx, invoice.siteId);
      guard(() =>
        assertCanRetryFne({
          status: invoice.status,
          fneStatus: invoice.fneStatus,
          mode: config?.mode ?? null,
        }),
      );
      const now = billingNow();
      // FAILED → PENDING (M08 §5), y compris après un rejet corrigé par l'utilisateur.
      await tenantDb.invoice.updateMany({
        where: { id: invoice.id, fneStatus: { in: [...UNCERTIFIED] } },
        data: { fneStatus: "PENDING", fneErrorKind: null, fneNextRetryAt: now },
      });
      await audit(actorOf(ctx), "invoice.fne_retry", "Invoice", invoice.id, {
        siteId: invoice.siteId,
        before: { fneStatus: invoice.fneStatus, fneError: invoice.fneError },
      });
      const result = await certifyInvoiceFne({
        organizationId: ctx.organizationId,
        invoiceId: invoice.id,
        now,
        resolveProvider: fneCertifierFor,
      });
      return {
        result,
        invoice: await tenantDb.invoice.findFirstOrThrow({ where: { id: invoice.id } }),
      };
    }),

  /** RG-M08-17 — saisie du numéro FNE et du QR (contenu décodé ou image) → `MANUAL`. */
  setManual: requirePermission("fne:manage")
    .input(fneSetManualInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = billingNow();
      return tenantDb.transaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId } });
        if (!invoice) invoiceNotFound();
        requireSite(ctx, invoice.siteId);
        const valid = guard(() =>
          validateManualFne(invoice, {
            fneNumber: input.fneNumber,
            qrCode: input.qrCode,
            hasQrImage: !!input.qrImage,
          }),
        );
        let qrCode = valid.qrCode;
        if (input.qrImage) {
          const [meta, base64] = input.qrImage.split(",", 2);
          const mimeType = meta!.slice(5, meta!.indexOf(";"));
          const body = Buffer.from(base64 ?? "", "base64");
          const key = `${ctx.organizationId}/invoices/${invoice.id}/fne-qr-${randomUUID()}.${mimeType.split("/")[1]}`;
          await getAttachmentStorage().upload({
            key,
            body,
            contentType: mimeType,
            maxBytes: 300_000,
          });
          const attachment = await tx.attachment.create({
            data: {
              organizationId: ctx.organizationId,
              entity: "invoice",
              entityId: invoice.id,
              kind: "fne_qr",
              url: key,
              mimeType,
              size: body.byteLength,
              createdById: ctx.membership.id,
            },
          });
          qrCode = qrCode ?? `attachment:${attachment.id}`;
        }
        const updated = await tx.invoice.updateMany({
          where: { id: invoice.id, fneStatus: { in: [...UNCERTIFIED] } },
          data: {
            fneStatus: "MANUAL",
            fneNumber: valid.fneNumber,
            fneQrCode: qrCode,
            fneCertifiedAt: now,
            fneError: null,
            fneErrorKind: null,
            fneNextRetryAt: null,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Cette facture vient d'être certifiée FNE.",
          });
        }
        await emitDomainEvent(tx as never, ctx.organizationId, "invoice.fne_certified", {
          invoiceId: invoice.id,
          number: invoice.number,
          fneNumber: valid.fneNumber,
          source: "manual",
        });
        await audit(actorOf(ctx), "invoice.fne_manual", "Invoice", invoice.id, {
          siteId: invoice.siteId,
          before: { fneStatus: invoice.fneStatus },
          after: { fneStatus: "MANUAL", fneNumber: valid.fneNumber, qrImage: !!input.qrImage },
        });
        return tx.invoice.findFirstOrThrow({ where: { id: invoice.id } });
      });
    }),
});
