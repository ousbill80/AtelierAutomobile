// RG-M11-26 : `defaultOutbox` (en mémoire) est propre à chaque processus — l'envoi M11 passe
// désormais par apps/worker (processus séparé), dont les messages console n'apparaîtraient
// jamais dans l'outbox en mémoire du serveur web. Cette route lit plutôt les `Message` réels
// (partagés via Postgres) pour le canal `console`.
import { adminDb } from "@atelieros/db";

export async function GET() {
  if (process.env.APP_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }
  const messages = await adminDb.message.findMany({
    where: { provider: "console", providerMessageId: { not: null }, direction: "OUTBOUND" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Response.json(
    messages.map((m) => ({
      id: m.providerMessageId!,
      channel: m.channel,
      to: m.to,
      body: m.body,
      status: m.status,
      errorCode: m.errorCode,
      sentAt: (m.sentAt ?? m.createdAt).toISOString(),
    })),
  );
}
