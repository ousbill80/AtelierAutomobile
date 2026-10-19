// RG-M11-17 : livré, rebond, plainte (email entrant = P1, hors périmètre). Routage par jeton
// secret dans l'URL (`?token=`), puis signature Svix pour `resend` (`verifyWebhook`).
import {
  createResendProvider,
  decryptSecret,
  loadEncryptionKey,
  type MessagingProvider,
} from "@atelieros/integrations";
import { findOrganizationByWebhookToken, recordStatusEvent } from "@/server/messaging/inbound";

function createProvider(
  provider: string,
  credentials: Record<string, unknown>,
): MessagingProvider | null {
  if (provider === "resend") {
    return createResendProvider(
      credentials as unknown as Parameters<typeof createResendProvider>[0],
    );
  }
  return null; // smtp : pas de webhook (RG-M11-17, email entrant/rebonds SMTP non pris en charge)
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await params;
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return new Response("Forbidden", { status: 403 });
  }

  const encryptionKey = loadEncryptionKey();
  const match = await findOrganizationByWebhookToken("EMAIL", providerName, token, (c) =>
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
    }
  }
  return new Response("OK", { status: 200 });
}
