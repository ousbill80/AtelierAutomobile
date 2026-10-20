// M14 RG-M14-18 — GET /p/{token}/events : flux Server-Sent Events du suivi d'OR. Le serveur
// relit l'empreinte de l'OR (statut, promesse, photos, remarques, devis, factures) toutes les
// 5 s et n'émet `update` que lorsqu'elle change : un passage à READY arrive en < 30 s sans
// dépendre d'un bus partagé entre instances. Connexion close après 10 min (le navigateur se
// reconnecte si l'onglet est actif) ; jeton révoqué ou expiré en cours de route → `gone`.
import { TRACKING_SERVER_CHECK_MS, TRACKING_STREAM_MAX_MS } from "@atelieros/core";
import { resolvePortalToken } from "@atelieros/db";
import { portalNow } from "@/server/portal/access";
import { checkPortalRequest } from "@/server/portal/rateLimit";
import { currentTrackingVersion } from "@/server/portal/tracking";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0"
  );
}

async function activeToken(token: string) {
  const resolved = await resolvePortalToken(token, ["REPAIR_ORDER"], portalNow(), {
    count: false,
  });
  return resolved.status === "ACTIVE" ? resolved.row : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rate = await checkPortalRequest(clientIp(req), portalNow());
  if (!rate.allowed) return new Response("Trop de requêtes", { status: 429 });
  const row = await activeToken(token);
  if (!row) return new Response("Lien expiré ou invalide", { status: 404 });

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        controller.close();
      };
      req.signal.addEventListener("abort", close);

      let version = await currentTrackingVersion(row);
      let lastBeat = Date.now();
      send(`retry: 5000\nevent: version\ndata: ${JSON.stringify({ version })}\n\n`);

      const tick = async () => {
        if (closed) return;
        try {
          if (Date.now() - startedAt >= TRACKING_STREAM_MAX_MS) {
            send(`event: bye\ndata: {}\n\n`);
            return close();
          }
          const current = await activeToken(token);
          if (!current) {
            send(`event: gone\ndata: {}\n\n`);
            return close();
          }
          const next = await currentTrackingVersion(current);
          if (next !== version) {
            version = next;
            send(`event: update\ndata: ${JSON.stringify({ version })}\n\n`);
          } else if (Date.now() - lastBeat >= HEARTBEAT_MS) {
            send(`: ping\n\n`);
            lastBeat = Date.now();
          }
        } catch {
          // Base momentanément injoignable : on réessaie au prochain tour.
        }
        timer = setTimeout(tick, TRACKING_SERVER_CHECK_MS);
      };
      timer = setTimeout(tick, TRACKING_SERVER_CHECK_MS);
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
