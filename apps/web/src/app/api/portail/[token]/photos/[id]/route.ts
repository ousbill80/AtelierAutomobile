// M04 RG-M04-18 — GET /api/portail/{token}/photos/{id} : photo partagée avec le client sur
// le lien de suivi. Jamais de signature ni de pièce hors de l'OR visé par le jeton.
// M05 : un jeton de portée QUOTE donne accès aux seules photos attachées aux lignes du devis.
import { db } from "@atelieros/db";
import { resolvePortalToken, roNow } from "@/server/repairOrders/helpers";
import { latestVersionOf, resolveQuoteToken } from "@/server/quotes/service";
import { getAttachmentStorage } from "@/server/storage";

const SHARED_KINDS = new Set(["photo_checkin", "photo_damage", "photo_inspection", "photo_work"]);

async function quotePhoto(token: string, id: string) {
  const resolved = await resolveQuoteToken(token, roNow());
  if (resolved.status !== "ACTIVE") return null;
  const tenantDb = db.forTenant({ organizationId: resolved.token.organizationId });
  const target = await tenantDb.quote.findFirst({ where: { id: resolved.token.targetId } });
  if (!target) return null;
  const quote = await tenantDb.transaction((tx) => latestVersionOf(tx, target));
  const line = await tenantDb.quoteLine.findFirst({
    where: { quoteId: quote.id, photoAttachmentIds: { has: id } },
  });
  if (!line) return null;
  return tenantDb.attachment.findFirst({ where: { id } });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const notFound = () => new Response("Introuvable", { status: 404 });
  let attachment;
  try {
    const record = await resolvePortalToken(token, roNow());
    const tenantDb = db.forTenant({ organizationId: record.organizationId });
    attachment = await tenantDb.attachment.findFirst({
      where: { id, entity: "repair_order", entityId: record.targetId },
    });
  } catch {
    attachment = await quotePhoto(token, id);
  }
  if (!attachment || !SHARED_KINDS.has(attachment.kind)) return notFound();
  try {
    const bytes = await getAttachmentStorage().getObjectBytes(attachment.url);
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": attachment.mimeType, "cache-control": "private, max-age=3600" },
    });
  } catch {
    return notFound();
  }
}
