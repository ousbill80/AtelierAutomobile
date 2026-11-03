// M09 RG-M09-16 — mise en demeure de payer : données du PDF, envoi par email (PDF joint, avec
// accusé de réception du fournisseur) et « remise » consignée (main propre, huissier,
// recommandé…). Le contenu est un modèle : la plateforme ne fournit pas de conseil juridique.
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_FORMAL_NOTICE_CLOSING,
  DEFAULT_FORMAL_NOTICE_DELAY_DAYS,
  OPEN_INVOICE_STATUSES,
  deliveryState,
  formalNoticeDeadline,
  formalNoticeFileName,
} from "@atelieros/core";
import { adminDb, type db } from "@atelieros/db";
import { renderFormalNoticePdf, type FormalNoticePdfData } from "@atelieros/pdf";

type TenantDb = ReturnType<typeof db.forTenant>;

export const FORMAL_NOTICE_KEY_PREFIX = "fn:";

export async function buildFormalNotice(
  tenantDb: TenantDb,
  organizationId: string,
  caseId: string,
  today: Date,
): Promise<{ data: FormalNoticePdfData; fileName: string; customerId: string }> {
  const kase = await tenantDb.collectionCase.findFirst({
    where: { id: caseId },
    include: {
      customer: {
        select: {
          id: true,
          displayName: true,
          ncc: true,
          rccm: true,
          address: true,
          commune: true,
        },
      },
    },
  });
  if (!kase) throw new TRPCError({ code: "NOT_FOUND", message: "Dossier introuvable." });

  const [org, invoices, owner] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        legalName: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        rccm: true,
        ncc: true,
        logoUrl: true,
      },
    }),
    tenantDb.invoice.findMany({
      where: {
        customerId: kase.customerId,
        billTo: "CUSTOMER",
        status: { in: [...OPEN_INVOICE_STATUSES] },
        balance: { gt: 0 },
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      select: { number: true, issuedAt: true, fneNumber: true, total: true, balance: true },
    }),
    tenantDb.membership.findFirst({
      where: { role: "OWNER", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { name: true } } },
    }),
  ]);
  if (invoices.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ce client n'a plus de facture impayée : pas de mise en demeure à faire.",
    });
  }

  const issuedOn = kase.formalNoticeAt ?? today;
  const delayDays = DEFAULT_FORMAL_NOTICE_DELAY_DAYS;
  const data: FormalNoticePdfData = {
    garage: { ...org, logo: org.logoUrl },
    customer: kase.customer,
    issuedOn: issuedOn.toISOString().slice(0, 10),
    deadline: formalNoticeDeadline(issuedOn, delayDays).toISOString().slice(0, 10),
    delayDays,
    invoices,
    totalDue: invoices.reduce((sum, i) => sum + i.balance, 0),
    closingText: DEFAULT_FORMAL_NOTICE_CLOSING,
    signerName: owner?.user.name ?? org.legalName ?? org.name,
  };
  return {
    data,
    fileName: formalNoticeFileName(kase.customer.displayName, issuedOn),
    customerId: kase.customerId,
  };
}

export async function renderFormalNotice(data: FormalNoticePdfData): Promise<Buffer> {
  return renderFormalNoticePdf(data);
}

/** Envois électroniques de la mise en demeure et leur accusé de réception. */
export async function formalNoticeSendings(tenantDb: TenantDb, caseId: string) {
  const messages = await tenantDb.message.findMany({
    where: { idempotencyKey: { startsWith: `${FORMAL_NOTICE_KEY_PREFIX}${caseId}:` } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      channel: true,
      to: true,
      status: true,
      provider: true,
      createdAt: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
    },
    take: 10,
  });
  return messages.map((m) => ({
    id: m.id,
    channel: m.channel,
    to: m.to,
    createdAt: m.createdAt,
    deliveredAt: m.deliveredAt,
    readAt: m.readAt,
    state: deliveryState(m),
  }));
}
