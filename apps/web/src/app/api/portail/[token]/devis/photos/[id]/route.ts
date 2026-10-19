// M05 US-M05-05 — GET /api/portail/{token}/devis/photos/{id} : photo d'inspection attachée à
// un groupe du devis (jamais une signature, jamais hors de l'OR du devis visé par le jeton).
import { db } from "@atelieros/db";
import { quoteNow, resolveQuoteToken } from "@/server/quotes/helpers";
import { getAttachmentStorage } from "@/server/storage";

const SHARED_KINDS = new Set(["photo_checkin", "photo_damage", "photo_inspection", "photo_work"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const notFound = () => new Response("Introuvable", { status: 404 });
  const resolved = await resolveQuoteToken(token, quoteNow(), false);
  if (resolved.status !== "ACTIVE") return notFound();
  const tenantDb = db.forTenant({ organizationId: resolved.organizationId });
  const quote = await tenantDb.quote.findFirst({
    where: { id: resolved.quoteId },
    select: { repairOrderId: true, lines: { select: { photoAttachmentIds: true } } },
  });
  if (!quote || !quote.lines.some((l) => l.photoAttachmentIds.includes(id))) return notFound();
  const attachment = await tenantDb.attachment.findFirst({ where: { id } });
  if (
    !attachment ||
    !SHARED_KINDS.has(attachment.kind) ||
    attachment.entity !== "repair_order" ||
    attachment.entityId !== quote.repairOrderId
  ) {
    return notFound();
  }
  try {
    const bytes = await getAttachmentStorage().getObjectBytes(attachment.url);
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": attachment.mimeType, "cache-control": "private, max-age=3600" },
    });
  } catch {
    return notFound();
  }
}
