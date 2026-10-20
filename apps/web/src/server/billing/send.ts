// M08 US-M08-09 / US-M08-14, M14 §7 « Lien client » — envoi d'une facture au client par
// WhatsApp, SMS ou email : lien portail INVOICE (voir, télécharger, payer), lien de paiement
// du solde quand un fournisseur est actif, PDF joint (email, WhatsApp). La facture est relue
// juste avant l'envoi (émise, non annulée ; certification FNE si paramétrée).
import { TRPCError } from "@trpc/server";
import {
  clientNamespace,
  invoiceSendBlocker,
  invoiceSendMessage,
  isInvoicePayable,
} from "@atelieros/core";
import { db, type Invoice } from "@atelieros/db";
import { messagingEnqueue, type EnqueueAttachment } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import { getAttachmentStorage } from "../storage";
import { renderInvoicePdfFor } from "./pdf";
import { createInvoicePaymentLink, issueInvoicePortalLink } from "./paymentLinks";
import { audit, bad, type Actor, type OrgBillingContext } from "./service";

export type SendChannel = "WHATSAPP" | "SMS" | "EMAIL";

export function invoicePdfFilename(invoice: Pick<Invoice, "number" | "id">): string {
  return `${invoice.number ?? `facture-${invoice.id}`}.pdf`;
}

/** Lien de paiement du solde, si un fournisseur est actif ; sinon null (le portail suffit). */
async function paymentUrlFor(
  org: OrgBillingContext,
  invoice: Invoice,
  actor: Actor,
): Promise<string | null> {
  if (!isInvoicePayable(invoice)) return null;
  try {
    const link = await createInvoicePaymentLink({
      organizationId: org.id,
      invoiceId: invoice.id,
      reuse: true,
      createdById: actor.membershipId,
      now: org.now,
    });
    return link.url;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED") return null;
    throw error;
  }
}

export async function sendInvoice(
  actor: Actor,
  org: OrgBillingContext,
  input: { invoice: Invoice; channel: SendChannel; includePaymentLink: boolean },
): Promise<{ messageId: string; publicUrl: string; paymentUrl: string | null; sentTo: string }> {
  const blocker = invoiceSendBlocker({
    status: input.invoice.status,
    fneStatus: input.invoice.fneStatus,
    blockSendUntilCertified: org.settings.blockSendUntilCertified,
  });
  if (blocker) bad(blocker);
  if (input.invoice.type === "CREDIT_NOTE" || input.invoice.billTo !== "CUSTOMER") {
    bad("Seules les factures client s'envoient depuis cet écran.");
  }
  const paymentUrl = input.includePaymentLink
    ? await paymentUrlFor(org, input.invoice, actor)
    : null;

  const tenantDb = db.forTenant({ organizationId: org.id });
  const out = await tenantDb.transaction(
    async (tx) => {
      // Revérification juste avant l'envoi (annulée ou avoir total entre-temps).
      const invoice = await tx.invoice.findFirstOrThrow({ where: { id: input.invoice.id } });
      const again = invoiceSendBlocker({
        status: invoice.status,
        fneStatus: invoice.fneStatus,
        blockSendUntilCertified: org.settings.blockSendUntilCertified,
      });
      if (again) bad(again);
      const customer = await tx.customer.findFirstOrThrow({ where: { id: invoice.customerId } });
      const link = await issueInvoicePortalLink(tx, invoice, actor.membershipId, org.now);
      const attachments: EnqueueAttachment[] = [];
      if (input.channel !== "SMS") {
        const pdf = await renderInvoicePdfFor(tx, org, invoice);
        const key = `${org.id}/invoices/${invoice.id}/${invoicePdfFilename(invoice)}`;
        await getAttachmentStorage().upload({
          key,
          body: pdf,
          contentType: "application/pdf",
          maxBytes: 5_000_000,
        });
        attachments.push({ kind: "pdf", storageKey: key, filename: invoicePdfFilename(invoice) });
      }
      const body = invoiceSendMessage({
        customerName: clientNamespace(customer).salutation,
        garageName: org.name,
        invoiceNumber: invoice.number ?? "",
        total: invoice.total,
        balance: invoice.balance,
        portalUrl: link.url,
        paymentUrl: invoice.balance > 0 ? paymentUrl : null,
      });
      const to = {
        phone: customer.phone,
        whatsapp: customer.whatsappPhone ?? customer.phone,
        email: customer.email,
        name: customer.displayName,
      };
      const result = await messagingEnqueue(tx, org.id, {
        idempotencyKey: `inv:${invoice.id}:send:${org.now.getTime()}`,
        kind: "transactional",
        customerId: customer.id,
        to,
        channels: [input.channel],
        // WhatsApp hors fenêtre 24 h : modèle Meta approuvé « invoice_issued » requis (RG-M11-10).
        templateKey: input.channel === "WHATSAPP" ? "invoice_issued" : undefined,
        bodyOverride: body,
        subjectOverride: `Facture ${invoice.number ?? ""} — ${org.name}`,
        attachments,
        sentById: actor.membershipId,
      });
      if (!("message" in result)) {
        bad(
          input.channel === "WHATSAPP"
            ? "WhatsApp indisponible pour ce client (canal non configuré, pas de modèle approuvé ni de conversation ouverte) : envoyez par SMS ou copiez le lien."
            : "Destinataire injoignable sur ce canal (adresse absente ou canal non configuré) : copiez le lien ou choisissez un autre canal.",
        );
      }
      await tx.invoice.update({ where: { id: invoice.id }, data: { sentAt: org.now } });
      const sentTo =
        input.channel === "EMAIL"
          ? (to.email ?? "")
          : input.channel === "WHATSAPP"
            ? (to.whatsapp ?? "")
            : (to.phone ?? "");
      return { messageId: result.message.id, publicUrl: link.url, sentTo };
    },
    { timeout: 30_000 },
  );
  await audit(actor, "invoice.sent", "Invoice", input.invoice.id, {
    siteId: input.invoice.siteId,
    after: {
      channel: input.channel,
      messageId: out.messageId,
      withPaymentLink: Boolean(paymentUrl),
    },
  });
  await enqueueMessageSendJob(out.messageId).catch(() => undefined);
  return { ...out, paymentUrl };
}
