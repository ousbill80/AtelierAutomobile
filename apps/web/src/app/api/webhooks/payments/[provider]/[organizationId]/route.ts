// M08 RG-M08-24 — POST /api/webhooks/payments/{provider}/{organizationId} : notification d'un
// agrégateur (CinetPay, Wave, simulateur). Corps lu brut pour la signature HMAC ; statut et
// montant relus chez le fournisseur ; paiement créé une seule fois ; réponse rapide.
import { handlePaymentWebhook } from "@/server/billing/paymentLinks";
import { billingNow } from "@/server/billing/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string; organizationId: string }> },
) {
  const { provider, organizationId } = await params;
  const rawBody = await request.text();
  const result = await handlePaymentWebhook({
    provider,
    organizationId,
    rawBody: rawBody.slice(0, 100_000),
    headers: request.headers,
    now: billingNow(),
  });
  return Response.json(result.body, { status: result.status });
}
