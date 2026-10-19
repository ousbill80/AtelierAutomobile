import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/server/session-cookie-name";

const AUTH_PATHS = [
  "/connexion",
  "/inscription",
  "/verification",
  "/mot-de-passe-oublie",
  "/atelier",
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
  // Portail client public (`/p/[token]/…`, M03/M14) : authentifié par jeton, jamais par session.
  const isPortalPath = pathname.startsWith("/p/");
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
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
