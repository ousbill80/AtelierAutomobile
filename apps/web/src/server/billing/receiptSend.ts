// M08 RG-M08-24 (7) — envoi du reçu d'un paiement au comptoir (WhatsApp, SMS ou email avec le
// PDF joint), sur le canal choisi par le caissier. L'accusé de réception (✓✓) suit le message.
import { TRPCError } from "@trpc/server";
import { paymentReceiptMessage } from "@atelieros/core";
import { db } from "@atelieros/db";
import { messagingEnqueue, type EnqueueAttachment } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import { getAttachmentStorage } from "../storage";
import type { OrgBillingContext } from "./service";
import { renderReceiptPdfFor } from "./pdf";

export const RECEIPT_KEY_PREFIX = "rcpt:";

export async function sendCounterReceipt(
  org: OrgBillingContext,
  input: { paymentId: string; channel: "WHATSAPP" | "SMS" | "EMAIL"; sentById: string },
): Promise<{ messageId: string; to: string }> {
  const tenantDb = db.forTenant({ organizationId: org.id });
  const payment = await tenantDb.payment.findFirst({
    where: { id: input.paymentId },
    include: {
      allocations: {
        where: { voidedAt: null },
        select: { invoice: { select: { number: true, balance: true } } },
      },
    },
  });
  if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Paiement introuvable." });
  if (!payment.customerId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ce paiement n'est rattaché à aucun client.",
    });
  }
  if (payment.status !== "CONFIRMED") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Seul un paiement confirmé donne un reçu à envoyer.",
    });
  }
  const customer = await tenantDb.customer.findFirstOrThrow({ where: { id: payment.customerId } });
  const to = {
    phone: customer.phone,
    whatsapp: customer.whatsappPhone ?? customer.phone,
    email: customer.email,
    name: customer.displayName,
  };
  const address =
    input.channel === "EMAIL" ? to.email : input.channel === "WHATSAPP" ? to.whatsapp : to.phone;
  if (!address) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        input.channel === "EMAIL"
          ? "Ce client n'a pas d'email : choisissez WhatsApp ou SMS, ou complétez sa fiche."
          : "Ce client n'a pas de numéro : choisissez l'email, ou complétez sa fiche.",
    });
  }
  const invoice = payment.allocations[0]?.invoice ?? null;
  const attachments: EnqueueAttachment[] = [];
  if (input.channel === "EMAIL") {
    const pdf = await renderReceiptPdfFor(tenantDb as never, org, payment);
    const key = `${org.id}/receipts/${payment.id}/Recu-${payment.number}.pdf`;
    await getAttachmentStorage().upload({
      key,
      body: pdf,
      contentType: "application/pdf",
      maxBytes: 5_000_000,
    });
    attachments.push({ kind: "pdf", storageKey: key, filename: `Recu-${payment.number}.pdf` });
  }
  const message = await tenantDb.transaction(async (tx) => {
    const enqueued = await messagingEnqueue(tx, org.id, {
      idempotencyKey: `${RECEIPT_KEY_PREFIX}${payment.id}:${input.channel}:${org.now.getTime()}`,
      kind: "transactional",
      customerId: customer.id,
      to,
      channels: [input.channel],
      templateKey: input.channel === "WHATSAPP" ? "payment_receipt" : undefined,
      bodyOverride: paymentReceiptMessage({
        garageName: org.name,
        paymentNumber: payment.number,
        amount: payment.amount,
        invoiceNumber: invoice?.number ?? null,
        balanceAfter: invoice?.balance ?? 0,
      }),
      subjectOverride: `Reçu ${payment.number} — ${org.name}`,
      attachments,
      sentById: input.sentById,
    });
    if (!("message" in enqueued)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Ce canal n'est pas disponible (non configuré ou en erreur : Paramètres › Canaux).",
      });
    }
    return enqueued.message;
  });
  await enqueueMessageSendJob(message.id);
  return { messageId: message.id, to: address };
}
