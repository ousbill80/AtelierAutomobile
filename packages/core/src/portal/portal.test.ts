import { describe, expect, it } from "vitest";
import { publicStep, timelineIndex, PUBLIC_TIMELINE } from "../repairOrders/publicStatus";
import {
  canRequestNewLink,
  canSendPortalOtp,
  checkPortalOtp,
  deadlineStatus,
  decideRequest,
  DEFAULT_PORTAL_SETTINGS,
  effectiveTokenState,
  feedbackFollowUp,
  findForbiddenKeys,
  ipPrefix,
  isPortalOtpShape,
  isPortalTokenShape,
  isShortCodeShape,
  maskPhone,
  organizationSlug,
  portalOtpFromRandom,
  pickAllowed,
  portalAccessPurgeBefore,
  portalLinkPermissions,
  portalPathFor,
  portalSettingsFrom,
  portalTokenExpiry,
  PORTAL_SCOPES,
  PORTAL_TRACKING_KEYS,
  PORTAL_VEHICLE_KEYS,
  publicMeasurement,
  renewedTokenExpiry,
  shortCodeFromBytes,
  shouldBlockAfterInvalid,
  trackingVersion,
  validateFeedback,
  visitSummary,
  windowKey,
  windowTtlMs,
} from "./index";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("core/portal — jetons (RG-M14-01..05)", () => {
  it("reconnaît la forme d'un jeton base64url de 43 caractères", () => {
    expect(isPortalTokenShape("a".repeat(43))).toBe(true);
    expect(isPortalTokenShape("A_b-".repeat(10) + "xyz")).toBe(true);
    expect(isPortalTokenShape("court")).toBe(false);
    expect(isPortalTokenShape("a".repeat(42) + "/")).toBe(false);
  });

  it("alias court : 8 caractères base62", () => {
    const code = shortCodeFromBytes(new Uint8Array([0, 61, 62, 255, 10, 36, 1, 2]));
    expect(code).toHaveLength(8);
    expect(isShortCodeShape(code)).toBe(true);
    expect(code.startsWith("0z0")).toBe(true);
    expect(() => shortCodeFromBytes(new Uint8Array(4))).toThrow();
    expect(isShortCodeShape("abc")).toBe(false);
  });

  it("expiration par portée (RG-M14-03)", () => {
    const validUntil = new Date("2026-10-25T00:00:00.000Z");
    expect(portalTokenExpiry("QUOTE", { now: NOW, validUntil }).toISOString()).toBe(
      "2026-11-25T00:00:00.000Z",
    );
    expect(portalTokenExpiry("INVOICE", { now: NOW, issuedAt: NOW })).toEqual(day(180));
    expect(portalTokenExpiry("INVOICE", { now: NOW, issuedAt: day(-10), paidAt: NOW })).toEqual(
      day(30),
    );
    expect(portalTokenExpiry("REPAIR_ORDER", { now: NOW })).toEqual(day(90));
    expect(portalTokenExpiry("REPAIR_ORDER", { now: NOW, deliveredAt: day(-1) })).toEqual(day(29));
    expect(portalTokenExpiry("APPOINTMENT", { now: NOW, startsAt: day(3) })).toEqual(day(10));
    expect(portalTokenExpiry("BOOKING", { now: NOW })).toEqual(day(30));
    expect(portalTokenExpiry("VEHICLE", { now: NOW })).toEqual(day(90));
    expect(portalTokenExpiry("STATEMENT", { now: NOW })).toEqual(day(90));
    expect(portalTokenExpiry("SURVEY", { now: NOW })).toEqual(day(14));
  });

  it("un lien renouvelé reste lisible au moins 7 jours", () => {
    const longDelivered = day(-60);
    expect(renewedTokenExpiry("REPAIR_ORDER", { now: NOW, deliveredAt: longDelivered })).toEqual(
      day(7),
    );
    expect(renewedTokenExpiry("VEHICLE", { now: NOW })).toEqual(day(90));
  });

  it("3 demandes de nouveau lien par jour", () => {
    expect(canRequestNewLink(0)).toBe(true);
    expect(canRequestNewLink(2)).toBe(true);
    expect(canRequestNewLink(3)).toBe(false);
  });

  it("état effectif : la date l'emporte sur ACTIVE, REVOKED l'emporte sur tout", () => {
    expect(effectiveTokenState({ status: "ACTIVE", expiresAt: day(1) }, NOW)).toBe("ACTIVE");
    expect(effectiveTokenState({ status: "ACTIVE", expiresAt: NOW }, NOW)).toBe("EXPIRED");
    expect(effectiveTokenState({ status: "REVOKED", expiresAt: day(1) }, NOW)).toBe("REVOKED");
    expect(effectiveTokenState({ status: "EXPIRED", expiresAt: day(1) }, NOW)).toBe("EXPIRED");
  });

  it("aiguillage : chaque portée a une page", () => {
    const paths = PORTAL_SCOPES.map(portalPathFor);
    expect(paths).toEqual([
      "devis",
      "facture",
      "suivi",
      "rdv",
      "rdv",
      "vehicule",
      "releve",
      "avis",
    ]);
  });

  it("purge du journal à 12 mois", () => {
    expect(portalAccessPurgeBefore(NOW)).toEqual(day(-365));
  });
});

describe("core/portal — protection (RG-M14-06)", () => {
  it("tronque l'IP en /24 (IPv4) et /48 (IPv6)", () => {
    expect(ipPrefix("41.202.219.77")).toBe("41.202.219.0");
    expect(ipPrefix("::ffff:10.1.2.3")).toBe("10.1.2.0");
    expect(ipPrefix("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::");
    expect(ipPrefix("")).toBeNull();
    expect(ipPrefix("inconnu")).toBeNull();
  });

  it("masque le téléphone", () => {
    expect(maskPhone("+2250747218890")).toBe("+225 07 •• •• 88 90");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("+33612345678")).toBe("•••••••5678");
    expect(maskPhone("123")).toBe("••••");
  });

  it("limitation : 30 requêtes/min, blocage après 5 jetons invalides", () => {
    expect(decideRequest({ blocked: false, countInWindow: 30 })).toEqual({ allowed: true });
    expect(decideRequest({ blocked: false, countInWindow: 31 })).toEqual({
      allowed: false,
      reason: "TOO_MANY",
    });
    expect(decideRequest({ blocked: true, countInWindow: 1 })).toEqual({
      allowed: false,
      reason: "BLOCKED",
    });
    expect(shouldBlockAfterInvalid(4)).toBe(false);
    expect(shouldBlockAfterInvalid(5)).toBe(true);
  });

  it("fenêtres fixes : même clé dans la minute, TTL restant", () => {
    const a = windowKey("rl", "1.2.3.0", new Date("2026-10-20T10:00:05Z"), 60_000);
    const b = windowKey("rl", "1.2.3.0", new Date("2026-10-20T10:00:59Z"), 60_000);
    const c = windowKey("rl", "1.2.3.0", new Date("2026-10-20T10:01:00Z"), 60_000);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(windowTtlMs(new Date("2026-10-20T10:00:05Z"), 60_000)).toBe(55_000);
  });
});

describe("core/portal — suivi d'OR (RG-M14-16..18)", () => {
  it("correspondance des statuts OR → étape client", () => {
    expect(publicStep("CHECKED_IN")).toBe("RECEIVED");
    expect(publicStep("APPROVED")).toBe("IN_REPAIR");
    expect(publicStep("IN_PROGRESS")).toBe("IN_REPAIR");
    expect(publicStep("READY")).toBe("READY");
    expect(timelineIndex("WAITING_PARTS")).toBe(PUBLIC_TIMELINE.indexOf("IN_REPAIR"));
    expect(timelineIndex("DELIVERED")).toBe(PUBLIC_TIMELINE.length);
  });

  it("l'empreinte change avec le statut, les photos et la facture", () => {
    const base = {
      status: "IN_PROGRESS",
      updatedAt: NOW,
      promisedAt: null,
      photoCount: 2,
      noteCount: 0,
      quoteStates: ["ACCEPTED"],
      invoiceStates: [],
    };
    const v = trackingVersion(base);
    expect(trackingVersion({ ...base })).toBe(v);
    expect(trackingVersion({ ...base, status: "READY" })).not.toBe(v);
    expect(trackingVersion({ ...base, photoCount: 3 })).not.toBe(v);
    expect(trackingVersion({ ...base, invoiceStates: ["ISSUED:185000"] })).not.toBe(v);
  });

  it("mesures masquées si showMeasurements = false", () => {
    expect(publicMeasurement("3 mm", true)).toBe("3 mm");
    expect(publicMeasurement("3 mm", false)).toBeNull();
    expect(publicMeasurement(null, true)).toBeNull();
  });
});

describe("core/portal — véhicule et avis (RG-M14-20/21)", () => {
  const today = new Date("2026-10-20T00:00:00.000Z");
  it("badge d'échéance : Bientôt ≤ 30 j, Dépassée si passée", () => {
    expect(deadlineStatus(new Date("2026-11-19T00:00:00Z"), today)).toEqual({
      state: "SOON",
      daysLeft: 30,
    });
    expect(deadlineStatus(new Date("2026-11-20T00:00:00Z"), today).state).toBe("OK");
    expect(deadlineStatus(new Date("2026-10-19T00:00:00Z"), today)).toEqual({
      state: "OVERDUE",
      daysLeft: -1,
    });
    expect(deadlineStatus(today, today)).toEqual({ state: "SOON", daysLeft: 0 });
    expect(deadlineStatus(null, today)).toEqual({ state: "UNKNOWN", daysLeft: null });
  });

  it("résumé des travaux d'un passage", () => {
    expect(visitSummary(["Vidange", "Filtre", "Vidange"])).toBe("Vidange, Filtre");
    expect(visitSummary(["A", "B", "C", "D", "E"])).toBe("A, B, C +2");
    expect(visitSummary([])).toBe("");
  });

  it("validation de l'avis", () => {
    expect(validateFeedback({ rating: 5 })).toBeNull();
    expect(validateFeedback({ rating: 0 })).toMatch(/1 à 5/);
    expect(validateFeedback({ rating: 3.5 })).toMatch(/1 à 5/);
    expect(validateFeedback({ rating: 4, comment: "x".repeat(1001) })).toMatch(/1000/);
  });

  it("suite de l'avis : gérant prévenu si ≤ 3, avis Google si ≥ 4", () => {
    expect(feedbackFollowUp(3, "https://g.page/x")).toEqual({
      notifyOwner: true,
      googleReviewUrl: null,
    });
    expect(feedbackFollowUp(4, "https://g.page/x")).toEqual({
      notifyOwner: false,
      googleReviewUrl: "https://g.page/x",
    });
    expect(feedbackFollowUp(5, null).googleReviewUrl).toBeNull();
  });
});

describe("core/portal — OTP (RG-M14-22)", () => {
  it("code à 6 chiffres", () => {
    expect(portalOtpFromRandom(42)).toBe("000042");
    expect(portalOtpFromRandom(123_456_789)).toBe("456789");
    expect(isPortalOtpShape("012345")).toBe(true);
    expect(isPortalOtpShape("12345")).toBe(false);
  });

  it("3 envois par heure", () => {
    expect(canSendPortalOtp(2)).toBe(true);
    expect(canSendPortalOtp(3)).toBe(false);
  });

  it("vérification : expiré, verrouillé après 5 essais, consommé", () => {
    const fresh = { expiresAt: day(1), attempts: 0, consumedAt: null };
    expect(checkPortalOtp(fresh, true, NOW)).toBe("OK");
    expect(checkPortalOtp(fresh, false, NOW)).toBe("INVALID");
    expect(checkPortalOtp({ ...fresh, expiresAt: NOW }, true, NOW)).toBe("EXPIRED");
    expect(checkPortalOtp({ ...fresh, attempts: 5 }, true, NOW)).toBe("LOCKED");
    expect(checkPortalOtp({ ...fresh, consumedAt: NOW }, true, NOW)).toBe("CONSUMED");
  });
});

describe("core/portal — paramètres et DTO", () => {
  it("valeurs par défaut et surcharge partielle", () => {
    expect(portalSettingsFrom(null)).toEqual(DEFAULT_PORTAL_SETTINGS);
    const s = portalSettingsFrom({
      portal: {
        showMeasurements: false,
        googleReviewUrl: "https://g.page/r",
        cancelCutoffHours: "x",
      },
    });
    expect(s.showMeasurements).toBe(false);
    expect(s.googleReviewUrl).toBe("https://g.page/r");
    expect(s.cancelCutoffHours).toBe(2);
  });

  it("instantané des clés autorisées", () => {
    expect(PORTAL_TRACKING_KEYS).toMatchInlineSnapshot(`
      [
        "garage",
        "number",
        "vehicle",
        "status",
        "statusLabel",
        "cancelled",
        "timelineIndex",
        "steps",
        "promisedAt",
        "complaint",
        "signaturePending",
        "findings",
        "lines",
        "pendingLines",
        "total",
        "photos",
        "notes",
        "documents",
        "version",
        "ready",
      ]
    `);
    expect(PORTAL_VEHICLE_KEYS).toEqual(["garage", "vehicle", "deadlines", "visits"]);
  });

  it("détecte les clés interdites à toute profondeur et filtre le premier niveau", () => {
    expect(
      findForbiddenKeys({ a: 1, lines: [{ costPrice: 3 }], nested: { organizationId: "x" } }),
    ).toEqual(["lines[0].costPrice", "nested.organizationId"]);
    expect(findForbiddenKeys({ at: NOW, ok: [1, 2] })).toEqual([]);
    expect(pickAllowed({ number: "OR-1", secret: 1 }, ["number"])).toEqual({ number: "OR-1" });
  });
});

describe("core/portal — slug d'organisation", () => {
  it("nom simplifié sans accents + suffixe", () => {
    expect(organizationSlug("Garage Côte d'Ivoire Auto", "cm123ABC456")).toBe(
      "garage-cote-d-ivoire-auto-abc456",
    );
    expect(organizationSlug("***", "x1")).toBe("garage-x1");
  });
});

describe("core/portal — permissions des liens (M14 §10)", () => {
  it("devis : quote:send ; facture : invoice:read + message:send ; OR : repair_order:read", () => {
    expect(portalLinkPermissions("QUOTE").write).toEqual(["quote:send"]);
    expect(portalLinkPermissions("INVOICE").write).toEqual(["invoice:read", "message:send"]);
    expect(portalLinkPermissions("REPAIR_ORDER").read).toEqual(["repair_order:read"]);
    expect(portalLinkPermissions("APPOINTMENT").write).toContain("message:send");
  });
});
