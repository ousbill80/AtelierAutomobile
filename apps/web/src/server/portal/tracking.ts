// M14 §4.4 — espace client d'un OR : suivi (frise, promesse, photos, inspection, remarques
// visibles client), devis et factures de l'OR (RG-M14-02 : « suivi d'un OR + ses
// devis/factures »), version pour le temps réel (RG-M14-18). Jamais de notes internes, prix
// d'achat, nom de mécanicien ni pointages (RG-M14-17).
import { TRPCError } from "@trpc/server";
import {
  isQuoteAwaitingDecision,
  isWorkableLine,
  lineAmounts,
  pickAllowed,
  portalSettingsFrom,
  publicMeasurement,
  publicStep,
  PORTAL_PHOTO_KINDS,
  PORTAL_TRACKING_KEYS,
  PORTAL_VISIBLE_INVOICE_STATUSES,
  PORTAL_VISIBLE_QUOTE_STATUSES,
  PUBLIC_STATUS_LABELS,
  PUBLIC_TIMELINE,
  repairOrderTotals,
  timelineIndex,
  trackingVersion,
  type RepairOrderStatus,
} from "@atelieros/core";
import { adminDb, db, type PortalToken } from "@atelieros/db";
import { linkError } from "./access";
import { ensureChildToken } from "./links";

type TenantDb = ReturnType<typeof db.forTenant>;

/** Devis visibles d'un OR : dernière version de chaque numéro, jamais un brouillon. */
async function orderQuotes(tenantDb: TenantDb, repairOrderId: string) {
  return tenantDb.quote.findMany({
    where: {
      repairOrderId,
      deletedAt: null,
      supersededAt: null,
      status: { in: [...PORTAL_VISIBLE_QUOTE_STATUSES] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      number: true,
      version: true,
      status: true,
      total: true,
      acceptedTotal: true,
      validUntil: true,
      customerId: true,
    },
  });
}

/** Factures visibles d'un OR (jamais un brouillon ni une facture annulée). */
async function orderInvoices(tenantDb: TenantDb, repairOrderId: string) {
  return tenantDb.invoice.findMany({
    where: { repairOrderId, status: { in: [...PORTAL_VISIBLE_INVOICE_STATUSES] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      number: true,
      externalNumber: true,
      type: true,
      status: true,
      total: true,
      balance: true,
      issuedAt: true,
      customerId: true,
    },
  });
}

/** Vue publique complète de l'OR ciblé par un jeton REPAIR_ORDER actif. */
export async function buildTrackingView(token: PortalToken) {
  const tenantDb = db.forTenant({ organizationId: token.organizationId });
  const [org, order] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({
      where: { id: token.organizationId },
      select: { name: true, phone: true, address: true, vatEnabled: true, settings: true },
    }),
    tenantDb.repairOrder.findFirst({
      where: { id: token.targetId },
      include: {
        vehicle: { select: { plate: true, make: true, model: true } },
        site: { select: { name: true, phone: true, address: true } },
        lines: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
        inspections: {
          where: { completedAt: { not: null } },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        },
        workNotes: {
          where: { visibleToCustomer: true },
          orderBy: { createdAt: "asc" },
          select: { id: true, body: true, createdAt: true },
        },
      },
    }),
  ]);
  if (!order) linkError("NOT_FOUND");
  const settings = portalSettingsFrom(org.settings);
  const [photos, quotes, invoices] = await Promise.all([
    tenantDb.attachment.findMany({
      where: { entity: "repair_order", entityId: order.id, kind: { in: [...PORTAL_PHOTO_KINDS] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, caption: true },
    }),
    orderQuotes(tenantDb, order.id),
    orderInvoices(tenantDb, order.id),
  ]);
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
  const view = {
    garage: {
      name: org.name,
      phone: order.site?.phone ?? org.phone,
      address: order.site?.address ?? org.address,
    },
    number: order.number,
    vehicle: order.vehicle,
    status: step,
    statusLabel: step ? PUBLIC_STATUS_LABELS[step] : null,
    cancelled: order.status === "CANCELLED",
    ready: order.status === "READY",
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
          measurement: publicMeasurement(item.measurement, settings.showMeasurements),
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
    photos: photos.map((p) => ({ id: p.id, kind: p.kind, caption: p.caption })),
    notes: order.workNotes.map((n) => ({ id: n.id, body: n.body, at: n.createdAt })),
    documents: [
      ...quotes.map((q, index) => ({
        kind: "quote" as const,
        index,
        number: q.version > 1 ? `${q.number} v${q.version}` : q.number,
        status: q.status,
        total: q.acceptedTotal ?? q.total,
        balance: null,
        awaitingDecision: isQuoteAwaitingDecision(q.status),
      })),
      ...invoices.map((inv, index) => ({
        kind: "invoice" as const,
        index,
        number: inv.externalNumber ?? inv.number ?? "",
        status: inv.status,
        total: inv.total,
        balance: inv.balance,
        awaitingDecision: false,
      })),
    ],
    version: trackingVersion({
      status: order.status,
      updatedAt: order.updatedAt,
      promisedAt: order.promisedAt,
      photoCount: photos.length,
      noteCount: order.workNotes.length,
      quoteStates: quotes.map((q) => `${q.number}:${q.version}:${q.status}`),
      invoiceStates: invoices.map((i) => `${i.id}:${i.status}:${i.balance}`),
    }),
  };
  // Garde du DTO (M14 §12) : seules les clés autorisées sortent.
  return pickAllowed(view, PORTAL_TRACKING_KEYS) as typeof view;
}

/** Version seule (flux SSE) : mêmes ingrédients que `buildTrackingView`, sans le contenu. */
export async function currentTrackingVersion(token: PortalToken): Promise<string | null> {
  const tenantDb = db.forTenant({ organizationId: token.organizationId });
  const order = await tenantDb.repairOrder.findFirst({
    where: { id: token.targetId },
    select: { id: true, status: true, updatedAt: true, promisedAt: true },
  });
  if (!order) return null;
  const [photoCount, noteCount, quotes, invoices] = await Promise.all([
    tenantDb.attachment.count({
      where: { entity: "repair_order", entityId: order.id, kind: { in: [...PORTAL_PHOTO_KINDS] } },
    }),
    tenantDb.workNote.count({ where: { repairOrderId: order.id, visibleToCustomer: true } }),
    orderQuotes(tenantDb, order.id),
    orderInvoices(tenantDb, order.id),
  ]);
  return trackingVersion({
    status: order.status,
    updatedAt: order.updatedAt,
    promisedAt: order.promisedAt,
    photoCount,
    noteCount,
    quoteStates: quotes.map((q) => `${q.number}:${q.version}:${q.status}`),
    invoiceStates: invoices.map((i) => `${i.id}:${i.status}:${i.balance}`),
  });
}

/** Ouvre le devis ou la facture n° `index` de l'OR (jeton enfant, RG-M14-02). */
export async function openRepairOrderDocument(input: {
  parentToken: string;
  parent: PortalToken;
  kind: "quote" | "invoice";
  index: number;
  now: Date;
}): Promise<{ url: string }> {
  const { parent, now } = input;
  const tenantDb = db.forTenant({ organizationId: parent.organizationId });
  if (input.kind === "quote") {
    const doc = (await orderQuotes(tenantDb, parent.targetId))[input.index];
    if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document introuvable." });
    return ensureChildToken({
      parentToken: input.parentToken,
      organizationId: parent.organizationId,
      scope: "QUOTE",
      targetId: doc.id,
      customerId: doc.customerId,
      refs: { validUntil: doc.validUntil },
      now,
    });
  }
  const doc = (await orderInvoices(tenantDb, parent.targetId))[input.index];
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document introuvable." });
  return ensureChildToken({
    parentToken: input.parentToken,
    organizationId: parent.organizationId,
    scope: "INVOICE",
    targetId: doc.id,
    customerId: doc.customerId,
    refs: { issuedAt: doc.issuedAt },
    now,
  });
}
