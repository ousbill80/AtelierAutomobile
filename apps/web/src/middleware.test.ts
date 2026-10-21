import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("Web middleware security headers (Étape 7.1)", () => {
  it("injecte les en-têtes de sécurité sur les requêtes", () => {
    const req = new NextRequest("http://localhost:3000/connexion");
    const res = middleware(req);

    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Content-Security-Policy")).toContain("media-src 'self' blob:");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=(self)");
  });

  it("applique les règles de protection du portail pour /p/token", () => {
    const req = new NextRequest("http://localhost:3000/p/token-de-test/devis");
    const res = middleware(req);

    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
