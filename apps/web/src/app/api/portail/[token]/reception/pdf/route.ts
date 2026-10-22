// US-M04-01 — GET /api/portail/{token}/reception/pdf : bon de réception pour le client (sans
// compte), lien envoyé par WhatsApp / SMS à la dépose. Le jeton de suivi ne donne accès qu'à
// son OR et qu'au bon de réception (aucun prix).
import { db } from "@atelieros/db";
import { resolvePortalToken, roNow } from "@/server/repairOrders/helpers";
import { renderOrderPdf } from "@/server/repairOrders/pdf";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const notFound = () => new Response("Lien expiré ou invalide.", { status: 404 });
  let record;
  try {
    record = await resolvePortalToken(token, roNow());
  } catch {
    return notFound();
  }
  // L'OR doit appartenir au client du jeton (RG-M14 : un lien = un client, un dossier).
  const order = await db
    .forTenant({ organizationId: record.organizationId })
    .repairOrder.findFirst({ where: { id: record.targetId }, select: { customerId: true } });
  if (!order || order.customerId !== record.customerId) return notFound();
  const rendered = await renderOrderPdf({
    organizationId: record.organizationId,
    orderId: record.targetId,
    kind: "reception",
    allowedSiteIds: "ALL",
  });
  if (!rendered) return notFound();
  return new Response(rendered.pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${rendered.filename}"`,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
