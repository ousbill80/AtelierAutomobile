// M04 §8 — portail public (sans compte) : suivi de la réparation (US-M04-16) et signature à
// distance du bon de réception (US-M04-04). RG-M04-18 : jamais de notes internes, coûts,
// marges, noms des mécaniciens ni pointages.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  isWorkableLine,
  lineAmounts,
  PUBLIC_STATUS_LABELS,
  PUBLIC_TIMELINE,
  publicStep,
  repairOrderTotals,
  timelineIndex,
  type RepairOrderStatus,
} from "@atelieros/core";
import { adminDb, db, type Prisma } from "@atelieros/db";
import { portalSignReceptionInputSchema, portalTokenInputSchema } from "@atelieros/validators";
import { recomputeTotals, roNow, resolvePortalToken } from "../repairOrders/helpers";
import { getAttachmentStorage } from "../storage";
import { publicProcedure, router } from "../trpc";

const SHARED_KINDS = ["photo_checkin", "photo_damage", "photo_inspection", "photo_work"];

export const portalRepairOrderRouter = router({
  tracking: publicProcedure.input(portalTokenInputSchema).query(async ({ input }) => {
    const now = roNow();
    const token = await resolvePortalToken(input.token, now);
    const tenantDb = db.forTenant({ organizationId: token.organizationId });
    const [org, order] = await Promise.all([
      adminDb.organization.findUniqueOrThrow({
        where: { id: token.organizationId },
        select: { name: true, phone: true, address: true, vatEnabled: true },
      }),
      tenantDb.repairOrder.findFirst({
        where: { id: token.targetId },
        include: {
          vehicle: { select: { plate: true, make: true, model: true } },
          customer: { select: { displayName: true } },
          lines: true,
          statusHistory: { orderBy: { createdAt: "asc" } },
          inspections: {
            where: { completedAt: { not: null } },
            include: { items: { orderBy: { sortOrder: "asc" } } },
          },
        },
      }),
    ]);
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Lien expiré ou invalide." });
    const steps = PUBLIC_TIMELINE.map((step) => {
      const at = order.statusHistory.find(
        (h) => publicStep(h.toStatus as RepairOrderStatus) === step,
      )?.createdAt;
      return { step, label: PUBLIC_STATUS_LABELS[step], at: at ?? null };
    });
    const visibleLines = order.lines.filter(
      (l) => isWorkableLine(l) && (l.payer === "CUSTOMER" || l.payer === "INSURANCE"),
    );
    const checkIn = (order.checkIn ?? {}) as { remoteSignaturePending?: boolean };
    const step = publicStep(order.status);
    const photos = await tenantDb.attachment.findMany({
      where: { entity: "repair_order", entityId: order.id, kind: { in: SHARED_KINDS } },
      select: { id: true, kind: true },
    });
    return {
      garage: org,
      number: order.number,
      customerName: order.customer.displayName,
      vehicle: order.vehicle,
      status: step,
      statusLabel: step ? PUBLIC_STATUS_LABELS[step] : null,
      cancelled: order.status === "CANCELLED",
      timelineIndex: timelineIndex(order.status),
      steps,
      promisedAt: order.promisedAt,
      complaint: order.complaint,
      signaturePending: Boolean(checkIn.remoteSignaturePending),
      findings: order.inspections.flatMap((i) =>
        i.items
          .filter((item) => item.result === "URGENT" || item.result === "WATCH")
          .map((item) => ({
            id: item.id,
            category: item.category,
            label: item.label,
            result: item.result,
            measurement: item.measurement,
            photos: item.shareWithCustomer ? item.photoUrls.map((u) => u.split("/").pop()!) : [],
          })),
      ),
      lines: visibleLines.map((l) => ({
        id: l.id,
        type: l.type,
        description: l.description,
        quantity: l.quantity,
        total: lineAmounts(l, org.vatEnabled).total,
        isCustomerSupplied: l.isCustomerSupplied,
      })),
      pendingLines: order.lines
        .filter((l) => l.approval === "PENDING" && l.status !== "CANCELLED")
        .map((l) => ({
          id: l.id,
          description: l.description,
          total: lineAmounts(l, org.vatEnabled).total,
        })),
      total: repairOrderTotals(order.lines, org.vatEnabled).totalEstimate,
      photoIds: photos.map((p) => p.id),
    };
  }),

  /** Récapitulatif de réception pour la signature à distance. */
  reception: publicProcedure.input(portalTokenInputSchema).query(async ({ input }) => {
    const token = await resolvePortalToken(input.token, roNow());
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
    .mutation(async ({ input }) => {
      const now = roNow();
      const token = await resolvePortalToken(input.token, now);
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
            } as Prisma.InputJsonValue,
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
