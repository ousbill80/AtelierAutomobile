// RG-M11-16 : accusés de livraison / SMS entrants. Routage par jeton secret dans l'URL
// (`?token=`, propre à chaque ChannelConfig, cf. RG-M11-16 "jeton secret dans l'URL selon
// fournisseur"), puis signature spécifique au fournisseur via `verifyWebhook`.
import {
  createHttpSmsProvider,
  createOrangeSmsProvider,
  createTwilioProvider,
  decryptSecret,
  loadEncryptionKey,
  type MessagingProvider,
} from "@atelieros/integrations";
import {
  findOrganizationByWebhookToken,
  recordInboundMessage,
  recordStatusEvent,
} from "@/server/messaging/inbound";
import { webhookRateLimitResponse } from "@/server/security/sensitiveRateLimit";

function createProvider(
  provider: string,
  credentials: Record<string, unknown>,
): MessagingProvider | null {
  switch (provider) {
    case "orange_sms":
      return createOrangeSmsProvider(
        credentials as unknown as Parameters<typeof createOrangeSmsProvider>[0],
      );
    case "twilio":
      return createTwilioProvider(
        credentials as unknown as Parameters<typeof createTwilioProvider>[0],
      );
    case "http_sms":
      return createHttpSmsProvider(
        credentials as unknown as Parameters<typeof createHttpSmsProvider>[0],
      );
    default:
      return null;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const limited = webhookRateLimitResponse(req);
  if (limited) return limited;
  const { provider: providerName } = await params;
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return new Response("Forbidden", { status: 403 });
  }

  const encryptionKey = loadEncryptionKey();
  const match = await findOrganizationByWebhookToken("SMS", providerName, token, (c) =>
    decryptSecret(c, encryptionKey),
  );
  if (!match) {
    return new Response("Forbidden", { status: 403 });
  }

  const provider = createProvider(providerName, match.credentials);
  if (!provider) {
    return new Response("Not Found", { status: 404 });
  }

  if (!(await provider.verifyWebhook(req))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const events = await provider.parseWebhook(req);
  for (const event of events) {
    if (event.kind === "status" && event.providerMessageId && event.status) {
      await recordStatusEvent({
        organizationId: match.organizationId,
        providerMessageId: event.providerMessageId,
        status: event.status,
        occurredAt: event.occurredAt,
      });
    } else if (event.kind === "inbound" && event.from) {
      await recordInboundMessage({
        organizationId: match.organizationId,
        channel: "SMS",
        from: event.from,
        body: event.body ?? "",
        occurredAt: event.occurredAt,
      });
    }
  }
  return new Response("OK", { status: 200 });
}
