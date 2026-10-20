// M14 §4.3 — page facture du portail : jeton INVOICE (RG-M14-01..04), contenu RG-M14-13
// (sans donnée d'une autre ressource), bouton payer RG-M14-14, confirmation RG-M14-15.
import {
  billingSettingsFrom,
  isConfirmationOverdue,
  isInvoicePayable,
  portalPaymentMethods,
} from "@atelieros/core";
import { adminDb, db, notifyMembers, resolvePortalToken, type PortalToken } from "@atelieros/db";
import { fneQrSvg } from "@atelieros/pdf";

export type ResolvedInvoiceToken =
  { status: "ACTIVE"; token: PortalToken } | { status: "EXPIRED" | "REVOKED" | "NOT_FOUND" };

/**
 * Jeton public de portée INVOICE (lu par hash, hors contexte locataire : c'est lui qui fournit
 * l'organisation). `count` : une ouverture de page est comptée, pas un rafraîchissement de statut.
 */
export async function resolveInvoiceToken(
  token: string,
  now: Date,
  count: boolean,
): Promise<ResolvedInvoiceToken> {
  const resolved = await resolvePortalToken(token, ["INVOICE"], now, { count });
  if (resolved.status === "ACTIVE") return { status: "ACTIVE", token: resolved.row };
  return { status: resolved.status };
}

/** QR FNE affichable : contenu texte seulement (l'image importée reste dans le PDF). */
function qrContent(qrCode: string | null): string | null {
  return qrCode && !qrCode.startsWith("attachment:") ? qrCode : null;
}

/** RG-M14-13 — vue publique d'une facture : aucun téléphone ni adresse client. */
export async function buildInvoicePublicView(token: PortalToken, now: Date) {
  const tenantDb = db.forTenant({ organizationId: token.organizationId });
  const invoice = await tenantDb.invoice.findFirst({
    where: { id: token.targetId },
    include: {
      lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      vehicle: { select: { plate: true, make: true, model: true } },
      site: { select: { name: true, address: true, phone: true } },
    },
  });
  if (!invoice || invoice.status === "DRAFT") return null;
  const [org, configs, pending, lastAllocation] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({
      where: { id: token.organizationId },
      select: {
        name: true,
        legalName: true,
        logoUrl: true,
        rccm: true,
        ncc: true,
        address: true,
        phone: true,
        timezone: true,
        settings: true,
      },
    }),
    tenantDb.paymentProviderConfig.findMany({
      where: { isActive: true },
      select: { methods: true },
    }),
    tenantDb.paymentLink.findFirst({
      where: {
        invoiceId: invoice.id,
        status: "PENDING",
        createdById: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, amount: true, method: true, createdAt: true },
    }),
    tenantDb.paymentAllocation.findFirst({
      where: { invoiceId: invoice.id, voidedAt: null, payment: { status: "CONFIRMED" } },
      orderBy: { payment: { receivedAt: "desc" } },
      select: {
        amount: true,
        payment: { select: { number: true, method: true, receivedAt: true } },
      },
    }),
  ]);
  const methods = portalPaymentMethods(configs);
  const certified = invoice.fneStatus === "CERTIFIED" || invoice.fneStatus === "MANUAL";
  return {
    timeZone: org.timezone,
    garage: {
      name: org.legalName ?? org.name,
      logoUrl: org.logoUrl,
      rccm: org.rccm,
      ncc: org.ncc,
      address: invoice.site.address ?? org.address,
      phone: invoice.site.phone ?? org.phone,
    },
    invoice: {
      number: invoice.externalNumber ?? invoice.number,
      type: invoice.type,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      vehicle: invoice.vehicle,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountRate: l.discountRate,
        vatRate: l.vatRate,
        total: l.lineTotal,
      })),
      subtotal: invoice.subtotal,
      discountTotal: invoice.discountTotal,
      vatTotal: invoice.vatTotal,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balance: invoice.balance,
    },
    fne: certified
      ? {
          certified: true as const,
          number: invoice.fneNumber,
          qrSvg: await fneQrSvg(qrContent(invoice.fneQrCode)).catch(() => null),
        }
      : { certified: false as const, number: null, qrSvg: null },
    voided: invoice.status === "VOID",
    payable: isInvoicePayable(invoice) && methods.length > 0,
    methods,
    // RG-M14-14 : sans fournisseur actif, numéros marchands + référence à indiquer.
    merchantNumbers:
      isInvoicePayable(invoice) && methods.length === 0
        ? billingSettingsFrom(org.settings).merchantNumbers
        : null,
    pending: pending
      ? {
          amount: pending.amount,
          method: pending.method,
          since: pending.createdAt,
          overdue: isConfirmationOverdue(pending.createdAt, now),
        }
      : null,
    lastPayment: lastAllocation?.payment
      ? {
          amount: lastAllocation.amount,
          number: lastAllocation.payment.number,
          method: lastAllocation.payment.method,
          receivedAt: lastAllocation.payment.receivedAt,
        }
      : null,
  };
}

export type InvoicePublicView = NonNullable<Awaited<ReturnType<typeof buildInvoicePublicView>>>;

/** RG-M14-15 — 2 min sans confirmation : le caissier est prévenu (une fois par lien). */
export async function alertUnconfirmedPortalPayment(
  organizationId: string,
  link: { id: string; invoiceId: string; amount: number },
  invoiceNumber: string | null,
): Promise<void> {
  await db.forTenant({ organizationId }).transaction((tx) =>
    notifyMembers(
      tx,
      organizationId,
      { roles: ["CASHIER", "OWNER"] },
      {
        type: "payment.portal_unconfirmed",
        title: `Paiement en ligne non confirmé — ${invoiceNumber ?? "facture"}`,
        body: "Le client a lancé un paiement il y a plus de 2 minutes sans confirmation du fournisseur. Vérifiez le lien avant tout nouvel encaissement.",
        link: `/factures/${link.invoiceId}`,
        severity: "warning",
        dedupeKey: `payment.portal_unconfirmed:${link.id}`,
      },
    ),
  );
}
