// M04 §8 — portail public (sans compte) : suivi de la réparation (US-M04-16) et signature à
// distance du bon de réception (US-M04-04). RG-M04-18 : jamais de notes internes, coûts,
// marges, noms des mécaniciens ni pointages.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { adminDb, db, type Prisma } from "@atelieros/db";
import {
  portalOpenDocumentInputSchema,
  portalSignReceptionInputSchema,
  portalTokenInputSchema,
  portalTrackingInputSchema,
} from "@atelieros/validators";
import { recomputeTotals, roNow } from "../repairOrders/helpers";
import { requirePortalToken } from "../portal/access";
import { buildTrackingView, openRepairOrderDocument } from "../portal/tracking";
import { getAttachmentStorage } from "../storage";
import { publicProcedure, router } from "../trpc";

export const portalRepairOrderRouter = router({
  /**
   * M14 US-M14-04 — espace client de l'OR. `refresh` (temps réel / polling) ne compte pas
   * d'ouverture et ne consomme pas le quota par IP.
   */
  tracking: publicProcedure.input(portalTrackingInputSchema).query(async ({ ctx, input }) => {
    const token = await requirePortalToken(input.token, ["REPAIR_ORDER"], ctx, {
      now: roNow(),
      count: !input.refresh,
      skipRateLimit: input.refresh,
    });
    return buildTrackingView(token);
  }),

  /** Devis ou facture de l'OR suivi : URL d'un jeton enfant (RG-M14-02, enfants directs). */
  openDocument: publicProcedure
    .input(portalOpenDocumentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = roNow();
      const parent = await requirePortalToken(input.token, ["REPAIR_ORDER"], ctx, {
        now,
        count: false,
        action: "document_open",
      });
      return openRepairOrderDocument({
        parentToken: input.token,
        parent,
        kind: input.kind,
        index: input.index,
        now,
      });
    }),

  /** Récapitulatif de réception pour la signature à distance. */
  reception: publicProcedure.input(portalTokenInputSchema).query(async ({ ctx, input }) => {
    const token = await requirePortalToken(input.token, ["REPAIR_ORDER"], ctx, { now: roNow() });
    const tenantDb = db.forTenant({ organizationId: token.organizationId });
    const order = await tenantDb.repairOrder.findFirst({
      where: { id: token.targetId },
      include: { vehicle: { select: { plate: true, make: true, model: true } } },
    });
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Lien expiré ou invalide." });
    const checkIn = (order.checkIn ?? {}) as Record<string, unknown>;
    return {
      number: order.number,
      vehicle: order.vehicle,
      mileageIn: order.mileageIn,
      fuelLevel: order.fuelLevel,
      complaint: order.complaint,
      damages: (checkIn.damages as unknown[]) ?? [],
      noDamage: Boolean(checkIn.noDamage),
      items: (checkIn.items as unknown[]) ?? [],
      keysCount: checkIn.keysCount ?? null,
      belongings: checkIn.belongings ?? "",
      authorizationCeiling: (checkIn.authorizationCeiling as number) ?? 0,
      signaturePending: Boolean(checkIn.remoteSignaturePending),
      signedAt: order.signedAt,
    };
  }),

  signReception: publicProcedure
    .input(portalSignReceptionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = roNow();
      const token = await requirePortalToken(input.token, ["REPAIR_ORDER"], ctx, {
        now,
        count: false,
      });
      const tenantDb = db.forTenant({ organizationId: token.organizationId });
      const order = await tenantDb.repairOrder.findFirst({ where: { id: token.targetId } });
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Lien expiré ou invalide." });
      const checkIn = (order.checkIn ?? {}) as Record<string, unknown>;
      if (!checkIn.remoteSignaturePending) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La réception est déjà signée." });
      }
      const [meta, base64] = input.signatureDataUrl.split(",", 2);
      const mimeType = meta!.slice(5, meta!.indexOf(";"));
      const body = Buffer.from(base64 ?? "", "base64");
      const key = `${order.organizationId}/repair-orders/${order.id}/signature-${randomUUID()}.${mimeType.split("/")[1]}`;
      await getAttachmentStorage().upload({
        key,
        body,
        contentType: mimeType,
        maxBytes: 1_000_000,
      });
      await tenantDb.transaction(async (tx) => {
        const attachment = await tx.attachment.create({
          data: {
            organizationId: order.organizationId,
            entity: "repair_order",
            entityId: order.id,
            kind: "signature",
            url: key,
            mimeType,
            size: body.byteLength,
          },
        });
        await tx.repairOrder.update({
          where: { id: order.id },
          data: {
            signedAt: now,
            customerSignatureUrl: `/api/attachments/${attachment.id}`,
            checkIn: {
              ...checkIn,
              remoteSignaturePending: false,
              signerName: input.signerName,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        // RG-M04-08 : les travaux saisis à la réception sont approuvés par la signature.
        await tx.repairOrderLine.updateMany({
          where: { repairOrderId: order.id, approval: "PENDING", approvalSource: "CHECK_IN" },
          data: { approval: "APPROVED" },
        });
        const org = await adminDb.organization.findUniqueOrThrow({
          where: { id: order.organizationId },
          select: { vatEnabled: true },
        });
        await recomputeTotals(tx, order.id, org.vatEnabled);
      });
      return { ok: true };
    }),
});
