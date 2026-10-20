// Simulateur de paiement (hors production) : « le client paie » sur la page
// /p/paiement-simule/{ref}. Le simulateur signe un webhook comme un agrégateur, transmis au
// même traitement que les vrais webhooks, puis renvoie le client vers sa page facture.
import { adminDb, type PaymentProviderConfig } from "@atelieros/db";
import { defaultSimulatorLedger, FakePaymentProvider } from "@atelieros/integrations";
import { handlePaymentWebhook, providerFromConfig } from "@/server/billing/paymentLinks";
import { billingNow } from "@/server/billing/service";

export const dynamic = "force-dynamic";

const WEBHOOK_PATH = /\/api\/webhooks\/payments\/fake\/([^/?#]+)/;

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (process.env.APP_ENV === "production") return new Response("Introuvable.", { status: 404 });
  const { ref } = await params;
  const form = await request.formData();
  const outcome = form.get("outcome") === "fail" ? "FAILED" : "PAID";
  const record = defaultSimulatorLedger().get(ref);
  const organizationId = record?.notifyUrl?.match(WEBHOOK_PATH)?.[1];
  if (!record || !organizationId) {
    return new Response("Paiement simulé introuvable ou déjà traité.", { status: 404 });
  }
  const config: Pick<
    PaymentProviderConfig,
    "provider" | "isActive" | "credentials" | "methods"
  > | null = await adminDb.paymentProviderConfig.findFirst({
    where: { organizationId, provider: "fake" },
    select: { provider: true, isActive: true, credentials: true, methods: true },
  });
  if (!config) return new Response("Simulateur non configuré.", { status: 404 });
  const provider = providerFromConfig(config);
  if (!(provider instanceof FakePaymentProvider)) {
    return new Response("Simulateur non configuré.", { status: 404 });
  }
  const now = billingNow();
  const hook = provider.simulate(ref, { status: outcome, payerPhone: "+2250700000000" }, now);
  if (hook) {
    await handlePaymentWebhook({
      provider: "fake",
      organizationId,
      rawBody: hook.rawBody,
      headers: new Headers(hook.headers),
      now,
    });
  }
  const back = record.returnUrl ?? "/p/paiement-retour";
  return Response.redirect(new URL(back, request.url), 303);
}
