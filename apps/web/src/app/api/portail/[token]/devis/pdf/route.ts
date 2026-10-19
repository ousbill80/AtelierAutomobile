// M05 §7 — GET /api/portail/{token}/devis/pdf : PDF du devis pour le client (sans compte),
// version signée une fois décidé. Le jeton QUOTE ne donne accès qu'à ce devis.
import { db } from "@atelieros/db";
import { roNow } from "@/server/repairOrders/helpers";
import { quotePdfFilename, renderQuotePdfFor } from "@/server/quotes/pdf";
import { latestVersionOf, loadOrgQuoteContext, resolveQuoteToken } from "@/server/quotes/service";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveQuoteToken(token, roNow());
  if (resolved.status !== "ACTIVE")
    return new Response("Lien expiré ou invalide.", { status: 404 });
  const tenantDb = db.forTenant({ organizationId: resolved.token.organizationId });
  const target = await tenantDb.quote.findFirst({
    where: { id: resolved.token.targetId, deletedAt: null },
  });
  if (!target) return new Response("Lien expiré ou invalide.", { status: 404 });
  const org = await loadOrgQuoteContext(target.organizationId);
  const { quote, pdf } = await tenantDb.transaction(async (tx) => {
    const latest = await latestVersionOf(tx, target);
    const decided = ["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"].includes(
      latest.status,
    );
    return {
      quote: latest,
      pdf: await renderQuotePdfFor(tx, org, latest, decided ? "signed" : "customer"),
    };
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${quotePdfFilename(quote, "customer")}"`,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
