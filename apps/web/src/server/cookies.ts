import { SESSION_COOKIE_NAME } from "./context";

const isProduction = process.env.NODE_ENV === "production";

export function buildSessionCookie(token: string, expiresAt: Date): string {
  const secureFlag = isProduction ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly${secureFlag}; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}

export function clearSessionCookie(): string {
  const secureFlag = isProduction ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly${secureFlag}; SameSite=Lax; Max-Age=0`;
}
