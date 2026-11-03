// Lien court réutilisé (ou créé) pour le QR des PDF client : devis, facture, reçu.
import { portalTokenExpiry } from "@atelieros/core";
import { issuePortalToken, PortalScope } from "@atelieros/db";
import type { Tx } from "../billing/service";
import { appUrl } from "../repairOrders/helpers";

export async function ensurePortalQrUrl(
  tx: Tx,
  input: {
    organizationId: string;
    scope: "QUOTE" | "INVOICE";
    targetId: string;
    customerId: string;
    now: Date;
    validUntil?: Date | null;
    issuedAt?: Date | null;
    paidAt?: Date | null;
  },
): Promise<string> {
  const existing = await tx.portalToken.findFirst({
    where: {
      scope: input.scope,
      targetId: input.targetId,
      status: "ACTIVE",
      expiresAt: { gt: input.now },
      shortCode: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { shortCode: true },
  });
  if (existing?.shortCode) return `${appUrl()}/l/${existing.shortCode}`;

  const issued = await issuePortalToken(tx, {
    organizationId: input.organizationId,
    scope: input.scope === "QUOTE" ? PortalScope.QUOTE : PortalScope.INVOICE,
    targetId: input.targetId,
    customerId: input.customerId,
    expiresAt: portalTokenExpiry(input.scope, {
      now: input.now,
      validUntil: input.validUntil,
      issuedAt: input.issuedAt,
      paidAt: input.paidAt,
    }),
    withShortCode: true,
  });
  if (input.scope === "QUOTE") {
    await tx.quote.update({
      where: { id: input.targetId },
      data: { publicToken: issued.tokenHash },
    });
  } else {
    await tx.invoice.update({
      where: { id: input.targetId },
      data: { publicToken: issued.tokenHash },
    });
  }
  const page = input.scope === "QUOTE" ? "devis" : "facture";
  return issued.shortCode
    ? `${appUrl()}/l/${issued.shortCode}`
    : `${appUrl()}/p/${issued.token}/${page}`;
}
