import { NextResponse } from "next/server";

// Next.js en dev réécrit req.url vers http://localhost, même quand le téléphone
// appelle l'adresse du réseau local. Une redirection vers localhost reste sur le téléphone.
const SAFE_HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

export function browserOrigin(req: Request): string {
  const raw = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (raw && SAFE_HOST.test(raw) && !raw.includes("..")) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    return `${proto === "https" ? "https" : "http"}://${raw}`;
  }
  return new URL(req.url).origin;
}

export function redirectTo(req: Request, pathname: string, status = 303): NextResponse {
  return NextResponse.redirect(new URL(pathname, browserOrigin(req)), status);
}
