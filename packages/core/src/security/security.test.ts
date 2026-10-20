import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, getSecurityHeaders } from "./headers";
import { isSensitiveKey, sanitizeLogData, scrubLogMessage } from "./sanitizer";
import { checkSlidingWindowRateLimit } from "./rateLimit";

describe("Security module (Étape 7.1)", () => {
  describe("Security Headers & CSP", () => {
    it("génère des en-têtes sécurisés complets", () => {
      const headers = getSecurityHeaders({ enableHsts: true });
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Strict-Transport-Security"]).toContain("max-age=");
      expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
      expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    });

    it("permet d'ajouter des connectSources à la CSP", () => {
      const csp = buildContentSecurityPolicy({
        connectSources: ["https://api.excellence-auto.ci", "https://sentry.io"],
      });
      expect(csp).toContain("https://api.excellence-auto.ci");
      expect(csp).toContain("https://sentry.io");
    });
  });

  describe("Log Sanitization", () => {
    it("détecte correctement les clés sensibles", () => {
      expect(isSensitiveKey("password")).toBe(true);
      expect(isSensitiveKey("apiKey")).toBe(true);
      expect(isSensitiveKey("api_key")).toBe(true);
      expect(isSensitiveKey("otpCode")).toBe(true);
      expect(isSensitiveKey("secretToken")).toBe(true);
      expect(isSensitiveKey("pinCode")).toBe(true);
      expect(isSensitiveKey("customerName")).toBe(false);
      expect(isSensitiveKey("plate")).toBe(false);
    });

    it("masque les champs sensibles dans un objet", () => {
      const payload = {
        user: "admin",
        password: "super-secret-password",
        nested: {
          token: "jwt-token-value",
          status: "OK",
        },
      };

      const sanitized = sanitizeLogData(payload);
      expect(sanitized.password).toBe("********");
      expect(sanitized.nested.token).toBe("********");
      expect(sanitized.user).toBe("admin");
      expect(sanitized.nested.status).toBe("OK");
    });

    it("nettoie les téléphones et emails dans les chaînes de texte libre", () => {
      const text =
        "Le client avec email test@example.com et téléphone +2250747218890 a été notifié.";
      const scrubbed = scrubLogMessage(text);
      expect(scrubbed).not.toContain("test@example.com");
      expect(scrubbed).not.toContain("+2250747218890");
      expect(scrubbed).toContain("[EMAIL]");
      expect(scrubbed).toContain("[TÉLÉPHONE]");
    });
  });

  describe("Sliding Window Rate Limiter", () => {
    it("autorise tant que le quota n'est pas dépassé", () => {
      const now = 100_000;
      const timestamps = [now - 30_000, now - 10_000];
      const result = checkSlidingWindowRateLimit(timestamps, now, {
        maxRequests: 5,
        windowMs: 60_000,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it("bloque quand le quota est atteint", () => {
      const now = 100_000;
      const timestamps = [now - 40_000, now - 30_000, now - 20_000];
      const result = checkSlidingWindowRateLimit(timestamps, now, {
        maxRequests: 3,
        windowMs: 60_000,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetMs).toBe(20_000);
    });
  });
});
