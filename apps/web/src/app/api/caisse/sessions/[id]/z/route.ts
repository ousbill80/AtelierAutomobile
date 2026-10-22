// M08 §7 — GET /api/caisse/sessions/{id}/z : Z de caisse (PDF A4). Session + `payment:read` +
// portée par site.
import { db } from "@atelieros/db";
import { createContext } from "@/server/context";
import { renderCashClosingPdfFor } from "@/server/billing/pdf";
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
  const session = await tenantDb.cashSession.findFirst({ where: { id } });
  if (!session || (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(session.siteId))) {
    return error(404, "Session de caisse introuvable.");
  }
  const org = await loadOrgBillingContext(organizationId);
  const pdf = await tenantDb.transaction((tx) => renderCashClosingPdfFor(tx, org, session));
  const day = session.openedAt.toISOString().slice(0, 10);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="z-caisse-${day}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
