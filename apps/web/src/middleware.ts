import { NextResponse, type NextRequest } from "next/server";
import { connectSourcesFromEnv, getSecurityHeaders } from "@atelieros/core/security/headers";
import { SESSION_COOKIE_NAME } from "@/server/session-cookie-name";

const AUTH_PATHS = [
  "/connexion",
  "/inscription",
  "/verification",
  "/mot-de-passe-oublie",
  "/tablette/connexion",
];

/**
 * Garde légère au niveau des routes (Edge) : vérifie uniquement la présence du
 * cookie de session, sans toucher la base. La validité réelle (expiration,
 * permissions) est vérifiée par le contexte tRPC sur chaque appel serveur.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  const isAuthPath = AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const isInvitationPath = pathname.startsWith("/invitation/");
  // Portail client public (`/p/[token]/…`, M03 RDV, M04 suivi et signature à distance, M14) :
  // authentifié par jeton, jamais par session.
  const isPortalPath = pathname.startsWith("/p/") || pathname.startsWith("/l/");
  const isPublicPath = isAuthPath || isInvitationPath || isPortalPath;

  if (!hasSession && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // 01 §8 & Étape 7.1 : En-têtes HTTP de sécurité globaux (CSP, HSTS, X-Content-Type-Options, etc.)
  const secHeaders = getSecurityHeaders({
    enableHsts: process.env.NODE_ENV === "production",
    connectSources: connectSourcesFromEnv(),
  });
  for (const [key, val] of Object.entries(secHeaders)) {
    response.headers.set(key, val);
  }

  if (isPortalPath) {
    // M14 RG-M14-06 : pages client jamais indexées, jamais mises en cache partagé, et le jeton
    // de l'URL n'est jamais transmis dans l'en-tête Referer d'un lien sortant.
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export const config = {
  // M06 : le service worker et le manifeste de la PWA tablette restent publics.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)"],
};
