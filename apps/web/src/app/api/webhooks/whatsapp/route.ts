// RG-M11-11 : poignée de main GET (hub.verify_token), statuts/entrants POST (signature
// X-Hub-Signature-256, idempotence, routage multi-organisation par phone_number_id).
import { adminDb } from "@atelieros/db";
import {
  createWhatsappCloudProvider,
  decryptSecret,
  loadEncryptionKey,
} from "@atelieros/integrations";
import {
  findOrganizationByWhatsappPhoneNumberId,
  recordInboundMessage,
  recordStatusEvent,
} from "@/server/messaging/inbound";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("hub.mode") !== "subscribe") {
    return new Response("Forbidden", { status: 403 });
  }
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (!token) {
    return new Response("Forbidden", { status: 403 });
  }
  const match = await adminDb.channelConfig.findFirst({
    where: {
      channel: "WHATSAPP",
      provider: "whatsapp_cloud",
      isActive: true,
      webhookVerifyToken: token,
    },
  });
  if (!match) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200 });
}

interface WhatsappWebhookPayload {
  entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[];
}

export async function POST(req: Request) {
  const payload = (await req
    .clone()
    .json()
    .catch(() => null)) as WhatsappWebhookPayload | null;
  const phoneNumberId = payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (!phoneNumberId) {
    return new Response("OK", { status: 200 }); // événement sans metadata exploitable, ignoré (Meta attend 200)
  }

  const encryptionKey = loadEncryptionKey();
  const match = await findOrganizationByWhatsappPhoneNumberId(phoneNumberId, (c) =>
    decryptSecret(c, encryptionKey),
  );
  if (!match) {
    return new Response("OK", { status: 200 }); // numéro inconnu de cette instance
  }

  const provider = createWhatsappCloudProvider(
    match.credentials as unknown as Parameters<typeof createWhatsappCloudProvider>[0],
  );
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
        channel: "WHATSAPP",
        from: event.from,
        body: event.body ?? "",
        occurredAt: event.occurredAt,
      });
    }
  }
  return new Response("OK", { status: 200 });
}
