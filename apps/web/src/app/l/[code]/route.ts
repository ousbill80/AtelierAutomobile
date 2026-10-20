// M14 RG-M14-05 — GET /l/{code} : alias court des liens envoyés par SMS (8 caractères base62),
// redirection 302 vers la page du portail. Le jeton d'un lien court est dérivé de l'alias
// (HMAC du secret serveur) : rien de clair n'est stocké, et l'empreinte en base est revérifiée.
import { isShortCodeShape, portalPathFor } from "@atelieros/core";
import { findPortalTokenByShortCode, hashPortalToken, tokenForShortCode } from "@atelieros/db";
import { portalNow } from "@/server/portal/access";
import { checkPortalRequest, recordInvalidPortalToken } from "@/server/portal/rateLimit";

export const dynamic = "force-dynamic";

const HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0"
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const now = portalNow();
  const ip = clientIp(req);
  const rate = await checkPortalRequest(ip, now);
  if (!rate.allowed) return new Response("Trop de requêtes", { status: 429, headers: HEADERS });
  const row = isShortCodeShape(code) ? await findPortalTokenByShortCode(code) : null;
  const token = row ? tokenForShortCode(code) : null;
  if (!row || !token || hashPortalToken(token) !== row.tokenHash) {
    await recordInvalidPortalToken(ip, now);
    return new Response("Lien introuvable ou expiré.", { status: 404, headers: HEADERS });
  }
  const base = (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  // La page cible affiche elle-même l'état du lien (expiré, révoqué) et le renvoi de lien.
  return new Response(null, {
    status: 302,
    headers: { ...HEADERS, location: `${base}/p/${token}/${portalPathFor(row.scope)}` },
  });
}
