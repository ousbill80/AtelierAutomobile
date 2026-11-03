import { adminDb } from "@atelieros/db";
import { clearSessionCookie } from "@/server/cookies";
import { redirectTo } from "@/server/request-origin";
import { SESSION_COOKIE_NAME } from "@/server/session-cookie-name";

function sessionToken(req: Request): string | null {
  const raw = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.slice(SESSION_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
}

/** Quitte la tablette et revient à l'écran du code PIN, sans dépendre du JavaScript. */
export async function POST(req: Request) {
  const token = sessionToken(req);
  if (token) {
    await adminDb.session.deleteMany({ where: { token } }).catch(() => undefined);
  }
  const response = redirectTo(req, "/tablette/connexion");
  response.headers.append("set-cookie", clearSessionCookie());
  return response;
}
