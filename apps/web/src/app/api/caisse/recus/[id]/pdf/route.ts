// M08 §7 — GET /api/caisse/recus/{paymentId}/pdf : reçu ticket 80 mm. Session + `payment:read`.
import { db } from "@atelieros/db";
import { createContext } from "@/server/context";
import { renderReceiptPdfFor } from "@/server/billing/pdf";
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
  if (!ctx.permissions.has("payment:read"))
    return error(403, "Permission manquante : payment:read");
  const tenantDb = db.forTenant({ organizationId });
  const payment = await tenantDb.payment.findFirst({ where: { id } });
  if (!payment || (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(payment.siteId))) {
    return error(404, "Paiement introuvable.");
  }
  const org = await loadOrgBillingContext(organizationId);
  const pdf = await tenantDb.transaction((tx) => renderReceiptPdfFor(tx, org, payment));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${payment.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
