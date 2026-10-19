// M05 §7 — GET /api/portail/{token}/devis/pdf : PDF du devis depuis le lien public.
import { quoteNow, resolveQuoteToken } from "@/server/quotes/helpers";
import { renderQuotePdfFor } from "@/server/quotes/pdf";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveQuoteToken(token, quoteNow(), false);
  if (resolved.status !== "ACTIVE") return new Response("Lien expiré ou invalide.", { status: 404 });
  const result = await renderQuotePdfFor(resolved.organizationId, resolved.quoteId, "customer", null);
  if (!result) return new Response("Devis introuvable.", { status: 404 });
  return new Response(new Uint8Array(result.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="devis-${result.number}.pdf"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
