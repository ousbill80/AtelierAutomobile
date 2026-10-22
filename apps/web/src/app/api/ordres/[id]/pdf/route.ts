// US-M04-15 — GET /api/ordres/{id}/pdf?kind=reception|workshop|full|delivery : documents de
// l'OR. Session + `repair_order:read` + portée par site ; prix uniquement sur l'OR complet.
import type { RepairOrderPdfKind } from "@atelieros/pdf";
import { createContext } from "@/server/context";
import { REPAIR_ORDER_PDF_KINDS, renderOrderPdf } from "@/server/repairOrders/pdf";

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
  const kind = (new URL(req.url).searchParams.get("kind") ?? "full") as RepairOrderPdfKind;
  if (!REPAIR_ORDER_PDF_KINDS.has(kind)) return error(400, "Type de document inconnu.");

  const rendered = await renderOrderPdf({
    organizationId,
    orderId: id,
    kind,
    allowedSiteIds: ctx.allowedSiteIds,
  });
  if (!rendered) return error(404, "Ordre de réparation introuvable.");
  return new Response(rendered.pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${rendered.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
