// M14 US-M14-07 / RG-M14-20 — historique et échéances d'un véhicule (jeton VEHICLE) : seuls les
// passages du client du jeton sont listés (un véhicule revendu ne montre pas l'historique de
// l'ancien propriétaire), sans prix d'achat ni nom de mécanicien.
import { TRPCError } from "@trpc/server";
import {
  businessDate,
  deadlineStatus,
  pickAllowed,
  PORTAL_VEHICLE_KEYS,
  PORTAL_VISIBLE_INVOICE_STATUSES,
  visitSummary,
} from "@atelieros/core";
import { adminDb, db, type PortalToken } from "@atelieros/db";
import { linkError } from "./access";
import { ensureChildToken } from "./links";

type TenantDb = ReturnType<typeof db.forTenant>;

/** Passages du véhicule pour le client du jeton, du plus récent au plus ancien. */
async function visitsOf(tenantDb: TenantDb, token: PortalToken) {
  return tenantDb.repairOrder.findMany({
    where: {
      vehicleId: token.targetId,
      customerId: token.customerId,
      status: { not: "CANCELLED" },
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 30,
    select: {
      id: true,
      number: true,
      status: true,
      createdAt: true,
      deliveredAt: true,
      mileageIn: true,
      totalEstimate: true,
      lines: { where: { status: { not: "CANCELLED" } }, select: { description: true } },
      invoices: {
        where: {
          status: { in: [...PORTAL_VISIBLE_INVOICE_STATUSES] },
          customerId: token.customerId,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, total: true, issuedAt: true, customerId: true },
      },
    },
  });
}

const OPEN_STATUSES = new Set(["DELIVERED", "INVOICED"]);

export async function buildVehicleView(token: PortalToken, now: Date) {
  const tenantDb = db.forTenant({ organizationId: token.organizationId });
  const [org, vehicle] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({
      where: { id: token.organizationId },
      select: { name: true, phone: true, address: true, timezone: true },
    }),
    tenantDb.vehicle.findFirst({
      where: { id: token.targetId, customerId: token.customerId, deletedAt: null },
      select: {
        plate: true,
        make: true,
        model: true,
        year: true,
        estimatedMileage: true,
        currentMileage: true,
        inspectionExpiryDate: true,
        nextServiceDueDate: true,
        nextServiceDueMileage: true,
        insuranceExpiryDate: true,
      },
    }),
  ]);
  // Véhicule revendu ou supprimé : le lien ne montre plus rien.
  if (!vehicle) linkError("NOT_FOUND");
  const today = businessDate(now, org.timezone);
  const visits = await visitsOf(tenantDb, token);
  const view = {
    garage: { name: org.name, phone: org.phone, address: org.address },
    vehicle: {
      plate: vehicle.plate,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      mileage: vehicle.estimatedMileage ?? vehicle.currentMileage,
    },
    deadlines: {
      inspection: {
        date: vehicle.inspectionExpiryDate,
        ...deadlineStatus(vehicle.inspectionExpiryDate, today),
      },
      service: {
        date: vehicle.nextServiceDueDate,
        mileage: vehicle.nextServiceDueMileage,
        ...deadlineStatus(vehicle.nextServiceDueDate, today),
      },
      insurance: {
        date: vehicle.insuranceExpiryDate,
        ...deadlineStatus(vehicle.insuranceExpiryDate, today),
      },
    },
    visits: visits.map((v, index) => ({
      index,
      number: v.number,
      date: v.deliveredAt ?? v.createdAt,
      mileage: v.mileageIn,
      summary: visitSummary(v.lines.map((l) => l.description)),
      amount: v.invoices[0]?.total ?? v.totalEstimate,
      inProgress: !OPEN_STATUSES.has(v.status),
      hasInvoice: v.invoices.length > 0,
    })),
  };
  return pickAllowed(view, PORTAL_VEHICLE_KEYS) as typeof view;
}

/** Facture d'un passage, ou suivi d'un OR en cours (jetons enfants du jeton véhicule). */
export async function openVehicleDocument(input: {
  parentToken: string;
  parent: PortalToken;
  kind: "invoice" | "repair_order";
  index: number;
  now: Date;
}): Promise<{ url: string }> {
  const tenantDb = db.forTenant({ organizationId: input.parent.organizationId });
  const visit = (await visitsOf(tenantDb, input.parent))[input.index];
  if (!visit) throw new TRPCError({ code: "NOT_FOUND", message: "Passage introuvable." });
  if (input.kind === "repair_order") {
    return ensureChildToken({
      parentToken: input.parentToken,
      organizationId: input.parent.organizationId,
      scope: "REPAIR_ORDER",
      targetId: visit.id,
      customerId: input.parent.customerId,
      refs: { deliveredAt: visit.deliveredAt },
      now: input.now,
    });
  }
  const invoice = visit.invoices[0];
  if (!invoice)
    throw new TRPCError({ code: "NOT_FOUND", message: "Pas de facture pour ce passage." });
  return ensureChildToken({
    parentToken: input.parentToken,
    organizationId: input.parent.organizationId,
    scope: "INVOICE",
    targetId: invoice.id,
    customerId: invoice.customerId,
    refs: { issuedAt: invoice.issuedAt },
    now: input.now,
  });
}
