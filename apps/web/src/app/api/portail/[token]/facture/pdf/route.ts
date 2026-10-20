// M14 RG-M14-13 — GET /api/portail/{token}/facture/pdf : PDF de la facture pour le client
// (sans compte). Le jeton INVOICE ne donne accès qu'à cette facture.
import { db } from "@atelieros/db";
import { invoicePdfFilename } from "@/server/billing/send";
import { renderInvoicePdfFor } from "@/server/billing/pdf";
import { resolveInvoiceToken } from "@/server/billing/portal";
import { billingNow, loadOrgBillingContext } from "@/server/billing/service";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveInvoiceToken(token, billingNow(), false);
  if (resolved.status !== "ACTIVE")
    return new Response("Lien expiré ou invalide.", { status: 404 });
  const organizationId = resolved.token.organizationId;
  const tenantDb = db.forTenant({ organizationId });
  const invoice = await tenantDb.invoice.findFirst({ where: { id: resolved.token.targetId } });
  if (!invoice || invoice.status === "DRAFT") {
    return new Response("Lien expiré ou invalide.", { status: 404 });
  }
  const org = await loadOrgBillingContext(organizationId);
  const pdf = await tenantDb.transaction((tx) => renderInvoicePdfFor(tx, org, invoice));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${invoicePdfFilename(invoice)}"`,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
