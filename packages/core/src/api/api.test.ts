import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import {
  apiKeyPrefix,
  clampLimit,
  decideIdempotency,
  decodeCursor,
  encodeCursor,
  formatApiKey,
  isApiError,
  isApiKeyUsable,
  normalizeScopes,
  pageOf,
  parseBearerApiKey,
  parseUpdatedSince,
  rateLimitFor,
  shouldTouchLastUsed,
  slidingWindowDecision,
  truncateClientIp,
  validateIdempotencyKey,
} from "./publicApi";
import {
  activeWebhookSecrets,
  isPrivateAddress,
  nextEndpointFailures,
  normalizeWebhookEvents,
  planDeliveryOutcome,
  publicEventType,
  truncateResponseBody,
  validateWebhookUrl,
  verifyWebhookSignatureHeader,
  webhookEnvelope,
  webhookSignatureHeader,
  webhookSignedPayload,
  WEBHOOK_MAX_ATTEMPTS,
} from "./webhooks";

const now = new Date("2026-10-20T10:00:00Z");
const bytes = (n: number, v = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + v) % 256);

function errorOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("clés API (RG-M13-30/31)", () => {
  it("format ak_live_ + 32 caractères base62, préfixe affiché, lecture du Bearer", () => {
    const key = formatApiKey("live", bytes(32));
    expect(key).toMatch(/^ak_live_[0-9A-Za-z]{32}$/);
    expect(formatApiKey("test", bytes(32))).toMatch(/^ak_test_/);
    expect(apiKeyPrefix(key)).toBe(`${key.slice(0, 12)}…`);
    expect(parseBearerApiKey(`Bearer ${key}`)).toBe(key);
    expect(parseBearerApiKey(`bearer   ${key}`)).toBe(key);
    expect(parseBearerApiKey("Bearer ak_live_court")).toBeNull();
    expect(parseBearerApiKey(null)).toBeNull();
    expect(() => formatApiKey("live", bytes(10))).toThrow(/Aléa/);
  });

  it("scopes : connus, dédoublonnés, au moins un ; write n'implique pas read", () => {
    expect(normalizeScopes(["customers:write", "customers:read", "customers:read"])).toEqual([
      "customers:read",
      "customers:write",
    ]);
    const e = errorOf(() => normalizeScopes(["admin:all"]));
    expect(isDomainError(e) && e.code).toBe("api_key.unknown_scope");
    expect(() => normalizeScopes([])).toThrow(/au moins un/);
  });

  it("clé révoquée ou expirée inutilisable ; lastUsedAt au plus une fois par minute", () => {
    expect(isApiKeyUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(isApiKeyUsable({ revokedAt: now, expiresAt: null }, now)).toBe(false);
    expect(isApiKeyUsable({ revokedAt: null, expiresAt: now }, now)).toBe(false);
    expect(shouldTouchLastUsed(null, now)).toBe(true);
    expect(shouldTouchLastUsed(new Date(now.getTime() - 59_000), now)).toBe(false);
    expect(shouldTouchLastUsed(new Date(now.getTime() - 60_000), now)).toBe(true);
  });
});

describe("pagination (RG-M13-32)", () => {
  it("limit : défaut 50, plafonné à 200, invalide → 400", () => {
    expect(clampLimit(null)).toBe(50);
    expect(clampLimit("500")).toBe(200);
    const e = errorOf(() => clampLimit("0"));
    expect(isApiError(e) && e.status).toBe(400);
  });

  it("curseur opaque aller-retour, page suivante seulement s'il reste des lignes", () => {
    const c = encodeCursor({ at: now.toISOString(), id: "abc" });
    expect(decodeCursor(c)).toEqual({ at: now.toISOString(), id: "abc" });
    expect(decodeCursor(null)).toBeNull();
    expect(isApiError(errorOf(() => decodeCursor("pas-un-curseur")))).toBe(true);
    const rows = [1, 2, 3].map((i) => ({ id: `r${i}`, at: new Date(now.getTime() + i) }));
    const page = pageOf(rows, 2, (r) => r.at);
    expect(page.data.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(decodeCursor(page.next_cursor)).toEqual({ at: rows[1]!.at.toISOString(), id: "r2" });
    expect(pageOf(rows, 3, (r) => r.at).next_cursor).toBeNull();
  });

  it("updated_since ISO 8601", () => {
    expect(parseUpdatedSince("2026-10-01T00:00:00Z")).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(parseUpdatedSince(undefined)).toBeNull();
    expect(isApiError(errorOf(() => parseUpdatedSince("hier")))).toBe(true);
  });
});

describe("idempotence (RG-M13-33)", () => {
  it("clé obligatoire, ≤ 255 caractères", () => {
    expect(validateIdempotencyKey(" k1 ")).toBe("k1");
    const missing = errorOf(() => validateIdempotencyKey(""));
    expect(isApiError(missing) && missing.code).toBe("idempotency_key_required");
    expect(isApiError(errorOf(() => validateIdempotencyKey("x".repeat(256))))).toBe(true);
  });

  it("même corps → réponse rejouée ; corps différent → conflit ; expirée → exécution", () => {
    const stored = {
      requestHash: "h1",
      responseStatus: 201,
      responseBody: { id: "c1" },
      expiresAt: new Date(now.getTime() + 1),
    };
    expect(decideIdempotency(null, "h1", now)).toEqual({ action: "execute" });
    expect(decideIdempotency(stored, "h1", now)).toEqual({
      action: "replay",
      status: 201,
      body: { id: "c1" },
    });
    expect(decideIdempotency(stored, "h2", now)).toEqual({ action: "conflict" });
    expect(decideIdempotency({ ...stored, expiresAt: now }, "h2", now)).toEqual({
      action: "execute",
    });
  });
});

describe("limitation de débit (RG-M13-34)", () => {
  it("plafonds par offre", () => {
    expect(rateLimitFor("STARTER")).toBe(60);
    expect(rateLimitFor("PRO")).toBe(300);
    expect(rateLimitFor("NETWORK")).toBe(1_200);
    expect(rateLimitFor(null)).toBe(60);
  });

  it("fenêtre glissante d'une minute : 60e requête acceptée, 61e refusée avec délai", () => {
    const t = now.getTime();
    const hits = Array.from({ length: 59 }, (_, i) => t - 50_000 + i * 100);
    expect(slidingWindowDecision(hits, 60, t)).toMatchObject({ allowed: true, remaining: 0 });
    const full = [...hits, t - 1];
    const refused = slidingWindowDecision(full, 60, t);
    expect(refused).toMatchObject({ allowed: false, remaining: 0, resetSeconds: 10 });
    // Les requêtes de plus d'une minute ne comptent plus.
    expect(slidingWindowDecision(full, 60, t + 60_000)).toMatchObject({ allowed: true });
  });

  it("IP du journal d'accès tronquée", () => {
    expect(truncateClientIp("41.202.10.77")).toBe("41.202.10.0");
    expect(truncateClientIp("2001:db8:85a3:1::1")).toBe("2001:db8:85a3::");
    expect(truncateClientIp(null)).toBeNull();
  });
});

describe("webhooks sortants (RG-M13-38..40)", () => {
  it("événements publics : liste fermée, internes sans équivalent ignorés", () => {
    expect(publicEventType("invoice.issued")).toBe("invoice.issued");
    expect(publicEventType("stock.below_minimum")).toBeNull();
    expect(normalizeWebhookEvents(["payment.received", "invoice.issued"])).toEqual([
      "invoice.issued",
      "payment.received",
    ]);
    expect(() => normalizeWebhookEvents(["foo.bar"])).toThrow(/inconnu/);
  });

  it("enveloppe et en-tête de signature t=…,v1=…", () => {
    expect(
      webhookEnvelope({
        eventId: "abc",
        type: "payment.received",
        occurredAt: now,
        organizationId: "o1",
        data: { a: 1 },
      }),
    ).toEqual({
      id: "evt_abc",
      type: "payment.received",
      created_at: now.toISOString(),
      organization_id: "o1",
      data: { a: 1 },
    });
    expect(webhookSignedPayload(1760774400, "{}")).toBe("1760774400.{}");
    expect(webhookSignatureHeader(1760774400, ["aa", "bb"])).toBe("t=1760774400,v1=aa,v1=bb");
  });

  it("vérification côté destinataire : ±300 s, une signature valide suffit", () => {
    const expected = (t: number) => `sig${t}`;
    const header = webhookSignatureHeader(1000, ["old", "sig1000"]);
    expect(verifyWebhookSignatureHeader({ header, nowSeconds: 1200, expected })).toBe(true);
    expect(verifyWebhookSignatureHeader({ header, nowSeconds: 1301, expected })).toBe(false);
    expect(
      verifyWebhookSignatureHeader({ header: "t=1000,v1=x", nowSeconds: 1000, expected }),
    ).toBe(false);
  });

  it("rotation : l'ancien secret signe encore 24 h", () => {
    const later = new Date(now.getTime() + 3_600_000).toISOString();
    expect(
      activeWebhookSecrets({ current: "n", previous: "o", previousUntil: later }, now),
    ).toEqual(["n", "o"]);
    expect(
      activeWebhookSecrets({ current: "n", previous: "o", previousUntil: now.toISOString() }, now),
    ).toEqual(["n"]);
  });

  it("reprises 1 min → 24 h, 8 tentatives puis abandon", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(planDeliveryOutcome({ attempt: 1, responseStatus: 200, now })).toEqual({
      status: "SUCCEEDED",
      nextAttemptAt: null,
    });
    expect(planDeliveryOutcome({ attempt: 1, responseStatus: 500, now })).toEqual({
      status: "PENDING",
      nextAttemptAt: new Date(now.getTime() + 60_000),
    });
    expect(planDeliveryOutcome({ attempt: 7, responseStatus: null, now })).toEqual({
      status: "PENDING",
      nextAttemptAt: new Date(now.getTime() + 24 * 3_600_000),
    });
    expect(planDeliveryOutcome({ attempt: 8, responseStatus: 410, now })).toEqual({
      status: "FAILED",
      nextAttemptAt: null,
    });
  });

  it("50 échecs consécutifs → désactivation ; un succès remet le compteur à zéro", () => {
    expect(nextEndpointFailures(48, false)).toEqual({ consecutiveFailures: 49, disable: false });
    expect(nextEndpointFailures(49, false)).toEqual({ consecutiveFailures: 50, disable: true });
    expect(nextEndpointFailures(49, true)).toEqual({ consecutiveFailures: 0, disable: false });
    expect(truncateResponseBody("x".repeat(3_000))).toHaveLength(2_048);
  });

  it("anti-SSRF : https obligatoire, hôtes locaux et IP privées refusés", () => {
    expect(validateWebhookUrl("https://erp.garage.ci/hooks").hostname).toBe("erp.garage.ci");
    for (const bad of [
      "http://erp.garage.ci/hooks",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://192.168.1.10/x",
      "https://172.20.0.1/x",
      "https://169.254.169.254/latest",
      "https://[::1]/x",
      "https://user:pass@erp.garage.ci/x",
      "pas une url",
    ]) {
      expect(() => validateWebhookUrl(bad), bad).toThrow();
    }
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("::ffff:10.1.2.3")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
  });
});
