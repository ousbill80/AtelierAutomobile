// M04 RG-M04-18 — GET /api/portail/{token}/photos/{id} : photo partagée avec le client sur
// le lien de suivi. Jamais de signature ni de pièce hors de l'OR visé par le jeton.
import { db } from "@atelieros/db";
import { resolvePortalToken, roNow } from "@/server/repairOrders/helpers";
import { getAttachmentStorage } from "@/server/storage";

const SHARED_KINDS = new Set(["photo_checkin", "photo_damage", "photo_inspection", "photo_work"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const notFound = () => new Response("Introuvable", { status: 404 });
  let record;
  try {
    record = await resolvePortalToken(token, roNow());
  } catch {
    return notFound();
  }
  const tenantDb = db.forTenant({ organizationId: record.organizationId });
  const attachment = await tenantDb.attachment.findFirst({
    where: { id, entity: "repair_order", entityId: record.targetId },
  });
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
