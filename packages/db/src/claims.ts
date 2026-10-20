// M16 §9 — effets des autres modules sur le dossier sinistre, appelés dans leurs transactions :
// facture du dossier émise / payée / avoirée (M08) → INVOICED / PARTIALLY_PAID / PAID ; OR passé
// IN_PROGRESS (M04) → REPAIRING. Partagé par apps/web et le worker (paiements par lien, M08).
import { claimPaymentStatus, type ClaimStatusLike } from "@atelieros/core";
import type { ClaimStatus, Prisma } from "@prisma/client";
import type { ScopedTenantClient } from "./tenant";

type Tx = ScopedTenantClient;

/** Écrit la transition, sa trace dans la chronologie et l'événement `claim.status_changed`. */
export async function setClaimStatus(
  tx: Tx,
  input: {
    organizationId: string;
    claimId: string;
    from: ClaimStatusLike;
    to: ClaimStatusLike;
    membershipId: string | null;
    now: Date;
    reason?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.from === input.to) return;
  await tx.insuranceClaim.update({
    where: { id: input.claimId },
    data: {
      status: input.to as ClaimStatus,
      ...(input.to === "PAID" ? { closedAt: input.now } : {}),
      ...(input.from === "PAID" && input.to !== "PAID" ? { closedAt: null } : {}),
    },
  });
  await tx.claimActivity.create({
    data: {
      organizationId: input.organizationId,
      claimId: input.claimId,
      type: "status_change",
      body: input.reason ?? null,
      data: { from: input.from, to: input.to, ...input.data } as Prisma.InputJsonValue,
      createdById: input.membershipId,
    },
  });
  await tx.domainEvent.create({
    data: {
      organizationId: input.organizationId,
      type: "claim.status_changed",
      payload: { claimId: input.claimId, from: input.from, to: input.to } as Prisma.InputJsonValue,
    },
  });
}

const FINAL_OR_EARLY: ReadonlySet<string> = new Set([
  "OPENED",
  "EXPERT_SCHEDULED",
  "ESTIMATE_SENT",
  "REJECTED",
  "CANCELLED",
]);

/**
 * RG-M16-07 — recalcule le statut de règlement d'un dossier à partir de ses factures. Appelé après
 * chaque recalcul de solde d'une facture rattachée (`recomputeInvoiceBalance`).
 */
export async function syncClaimFromInvoices(tx: Tx, claimId: string, now: Date): Promise<void> {
  const claim = await tx.insuranceClaim.findFirst({
    where: { id: claimId },
    select: { id: true, organizationId: true, status: true },
  });
  if (!claim || FINAL_OR_EARLY.has(claim.status)) return;
  const invoices = await tx.invoice.findMany({
    where: { insuranceClaimId: claimId },
    select: {
      billTo: true,
      type: true,
      status: true,
      total: true,
      balance: true,
      amountPaid: true,
      creditedAmount: true,
    },
  });
  const drafts = invoices.some((i) => i.status === "DRAFT" && i.type !== "CREDIT_NOTE");
  const derived = claimPaymentStatus(invoices);
  // Tant qu'une des deux factures du dossier est en brouillon, il n'est pas encore « Facturé ».
  if (!derived || (drafts && derived === "INVOICED")) return;
  if (derived === claim.status) return;
  await setClaimStatus(tx, {
    organizationId: claim.organizationId,
    claimId: claim.id,
    from: claim.status as ClaimStatusLike,
    to: derived,
    membershipId: null,
    now,
  });
}

/** M16 §9 — OR passé `IN_PROGRESS` : dossier accordé → `REPAIRING`. */
export async function syncClaimFromRepairOrder(
  tx: Tx,
  input: { insuranceClaimId: string | null; to: string; now: Date; membershipId: string | null },
): Promise<void> {
  if (!input.insuranceClaimId || input.to !== "IN_PROGRESS") return;
  const claim = await tx.insuranceClaim.findFirst({
    where: { id: input.insuranceClaimId },
    select: { id: true, organizationId: true, status: true },
  });
  if (claim?.status !== "APPROVED") return;
  await setClaimStatus(tx, {
    organizationId: claim.organizationId,
    claimId: claim.id,
    from: "APPROVED",
    to: "REPAIRING",
    membershipId: input.membershipId,
    now: input.now,
  });
}
