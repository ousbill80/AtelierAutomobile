// M04 — GET /api/attachments/{id} : photo ou signature d'un OR. Session + permission
// `repair_order:read` + portée par site vérifiées ; l'objet est relu depuis le stockage.
import { db } from "@atelieros/db";
import { createContext } from "@/server/context";
import { getAttachmentStorage } from "@/server/storage";

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
  if (!ctx.user || !organizationId || !ctx.membership) {
    return error(401, "Session invalide ou expirée.");
  }
  if (!ctx.permissions.has("repair_order:read")) {
    return error(403, "Permission manquante : repair_order:read");
  }
  const tenantDb = db.forTenant({ organizationId });
  const attachment = await tenantDb.attachment.findFirst({ where: { id } });
  if (!attachment) return error(404, "Fichier introuvable.");
  if (attachment.entity === "repair_order" || attachment.entity === "repair_order_line") {
    // M06 : photo de travaux rattachée à une ligne d'OR → même contrôle de site que l'OR.
    const orderId =
      attachment.entity === "repair_order"
        ? attachment.entityId
        : (
            await tenantDb.repairOrderLine.findFirst({
              where: { id: attachment.entityId },
              select: { repairOrderId: true },
            })
          )?.repairOrderId;
    const order = await tenantDb.repairOrder.findFirst({
      where: { id: orderId ?? "" },
      select: { siteId: true },
    });
    if (!order || (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(order.siteId))) {
      return error(404, "Fichier introuvable.");
    }
  }
  try {
    const bytes = await getAttachmentStorage().getObjectBytes(attachment.url);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": attachment.mimeType,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return error(404, "Fichier introuvable.");
  }
}
