// M05 §8 `quote.pdf` — GET /api/devis/{id}/pdf?variant=customer|insurer|signed.
// Session + `quote:read` + portée par site.
import { db } from "@atelieros/db";
import type { QuotePdfVariant } from "@atelieros/pdf";
import { createContext } from "@/server/context";
import { renderQuotePdfFor } from "@/server/quotes/pdf";

const VARIANTS = new Set<QuotePdfVariant>(["customer", "insurer", "signed"]);

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
  if (!ctx.user || !organizationId || !ctx.membership) return error(401, "Session invalide ou expirée.");
  if (!ctx.permissions.has("quote:read")) return error(403, "Permission manquante : quote:read");
  const variant = (new URL(req.url).searchParams.get("variant") ?? "customer") as QuotePdfVariant;
  if (!VARIANTS.has(variant)) return error(400, "Variante inconnue.");
  const quote = await db
    .forTenant({ organizationId })
    .quote.findFirst({ where: { id, deletedAt: null }, select: { siteId: true } });
  if (!quote || (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(quote.siteId))) {
    return error(404, "Devis introuvable.");
  }
  const result = await renderQuotePdfFor(organizationId, id, variant, null);
  if (!result) return error(404, "Devis introuvable.");
  return new Response(new Uint8Array(result.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="devis-${result.number}${variant === "insurer" ? "-expertise" : ""}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
