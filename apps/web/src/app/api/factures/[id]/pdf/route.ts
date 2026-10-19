// M08 §8 `invoice.pdf` — GET /api/factures/{id}/pdf. Session + `invoice:read` + portée par site.
import { db } from "@atelieros/db";
import { createContext } from "@/server/context";
import { renderInvoicePdfFor } from "@/server/billing/pdf";
import { loadOrgBillingContext } from "@/server/billing/service";

function error(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  const organizationId = ctx.session?.activeOrganizationId;
  if (!ctx.user || !organizationId || !ctx.membership)
    return error(401, "Session invalide ou expirée.");
  if (!ctx.permissions.has("invoice:read"))
    return error(403, "Permission manquante : invoice:read");
  const tenantDb = db.forTenant({ organizationId });
  const invoice = await tenantDb.invoice.findFirst({ where: { id } });
  if (!invoice || (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(invoice.siteId))) {
    return error(404, "Facture introuvable.");
  }
  const org = await loadOrgBillingContext(organizationId);
  const pdf = await tenantDb.transaction((tx) => renderInvoicePdfFor(tx, org, invoice));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${invoice.number ?? "facture-brouillon"}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
