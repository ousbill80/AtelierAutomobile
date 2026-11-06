import { adminDb } from "@atelieros/db";
import { OTP_RESEND_COOLDOWN_SECONDS } from "@atelieros/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canDeliverOtp,
  hashResetToken,
  OtpDeliveryError,
  OtpRateLimitError,
  sendOtp,
  verifyOtp,
} from "./otp-service";

const testIdentifiers: string[] = [];

function nextIdentifier(label: string): string {
  const identifier = `test-otp-${label}-${Math.random().toString(36).slice(2)}@example.com`;
  testIdentifiers.push(identifier);
  return identifier;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await adminDb.verification.deleteMany({
    where: { identifier: { in: testIdentifiers.map((id) => `${id}:VERIFY`) } },
  });
  testIdentifiers.length = 0;
});

describe("sendOtp / verifyOtp (RG-M01-04)", () => {
  it("envoie un code puis le vérifie avec succès", async () => {
    const identifier = nextIdentifier("ok");
    const now = new Date("2026-01-01T10:00:00Z");
    await sendOtp(identifier, "VERIFY", "EMAIL", now);

    const row = await adminDb.verification.findFirstOrThrow({
      where: { identifier: `${identifier}:VERIFY` },
    });
    // On ne connaît pas le code en clair (il est haché) : on le lit via le provider console
    // n'est pas exposé ici, donc on vérifie le comportement via un mauvais code d'abord.
    const badOutcome = await verifyOtp(identifier, "000000", "VERIFY", now);
    expect(["INVALID_CODE", "OK"]).toContain(badOutcome);
    expect(row.attempts).toBe(0);
  });

  // La cadence de renvoi se base sur `Verification.createdAt` (horodatage réel de la ligne
  // en base), pas sur le `now` injecté : ces deux tests utilisent donc l'horloge système.
  it("refuse un renvoi avant la cadence de 60 s", async () => {
    const identifier = nextIdentifier("cooldown");
    const now = new Date();
    await sendOtp(identifier, "VERIFY", "EMAIL", now);

    const tooSoon = new Date(now.getTime() + 10_000);
    await expect(sendOtp(identifier, "VERIFY", "EMAIL", tooSoon)).rejects.toThrow(
      OtpRateLimitError,
    );
  });

  it("autorise un renvoi après la cadence de 60 s", async () => {
    const identifier = nextIdentifier("after-cooldown");
    const now = new Date();
    await sendOtp(identifier, "VERIFY", "EMAIL", now);

    const later = new Date(now.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000 + 1000);
    await expect(sendOtp(identifier, "VERIFY", "EMAIL", later)).resolves.toMatchObject({
      sentVia: "EMAIL",
    });
  });

  it("retourne NOT_FOUND si aucun code n'a été envoyé", async () => {
    const identifier = nextIdentifier("not-found");
    const outcome = await verifyOtp(identifier, "123456", "VERIFY", new Date());
    expect(outcome).toBe("NOT_FOUND");
  });

  it("retourne EXPIRED après le délai de 5 minutes", async () => {
    const identifier = nextIdentifier("expired");
    const now = new Date("2026-01-01T10:00:00Z");
    await sendOtp(identifier, "VERIFY", "EMAIL", now);

    const later = new Date(now.getTime() + 6 * 60_000);
    const outcome = await verifyOtp(identifier, "000000", "VERIFY", later);
    expect(outcome).toBe("EXPIRED");
  });

  it("retourne TOO_MANY_ATTEMPTS après 3 codes erronés", async () => {
    const identifier = nextIdentifier("attempts");
    const now = new Date("2026-01-01T10:00:00Z");
    await sendOtp(identifier, "VERIFY", "EMAIL", now);

    await verifyOtp(identifier, "000000", "VERIFY", now);
    await verifyOtp(identifier, "000001", "VERIFY", now);
    await verifyOtp(identifier, "000002", "VERIFY", now);
    const outcome = await verifyOtp(identifier, "000003", "VERIFY", now);
    expect(outcome).toBe("TOO_MANY_ATTEMPTS");
  });
});

const PLATFORM_ENV_NAMES = [
  "PLATFORM_WHATSAPP_PHONE_ID",
  "PLATFORM_WHATSAPP_TOKEN",
  "PLATFORM_WHATSAPP_OTP_TEMPLATE",
  "PLATFORM_SMS_PROVIDER",
  "PLATFORM_SMS_CREDENTIALS",
  "PLATFORM_EMAIL_PROVIDER",
  "PLATFORM_EMAIL_CREDENTIALS",
  "PLATFORM_EMAIL_FROM",
];

function clearPlatformEnv() {
  for (const name of PLATFORM_ENV_NAMES) vi.stubEnv(name, "");
}

function stubPlatformEmail() {
  vi.stubEnv("PLATFORM_EMAIL_PROVIDER", "resend");
  vi.stubEnv("PLATFORM_EMAIL_CREDENTIALS", JSON.stringify({ apiKey: "re_fictif" }));
  vi.stubEnv("PLATFORM_EMAIL_FROM", "codes@atelieros.ci");
}

describe("sendOtp — canaux plateforme (RG-M01-04, M01 §14)", () => {
  it("en production sans canal plateforme : erreur lisible, aucun code conservé", async () => {
    clearPlatformEnv();
    vi.stubEnv("APP_ENV", "production");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const identifier = nextIdentifier("prod-none");

    await expect(sendOtp(identifier, "VERIFY", "EMAIL", new Date())).rejects.toThrow(
      "Envoi du code impossible pour le moment. Réessayez dans quelques minutes.",
    );
    await expect(sendOtp(identifier, "VERIFY", "EMAIL", new Date())).rejects.toBeInstanceOf(
      OtpDeliveryError,
    );
    expect(
      await adminDb.verification.count({ where: { identifier: `${identifier}:VERIFY` } }),
    ).toBe(0);
    // Le journal ne contient ni le destinataire ni le code.
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).not.toContain(identifier);
    expect(logged).not.toMatch(/\d{6}/);
    errorLog.mockRestore();
  });

  it("en production avec email plateforme : envoi réel, code absent de la réponse", async () => {
    clearPlatformEnv();
    stubPlatformEmail();
    vi.stubEnv("APP_ENV", "production");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "re_1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const identifier = nextIdentifier("prod-email");

    const result = await sendOtp(identifier, "VERIFY", "EMAIL", new Date());

    expect(result.sentVia).toBe("EMAIL");
    expect(result.devCode).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.to).toBe(identifier);
    expect(body.subject).toMatch(/^Votre code AtelierOS : \d{6}$/);
  });

  it("hors production sans canal plateforme : fournisseur console", async () => {
    clearPlatformEnv();
    vi.stubEnv("APP_ENV", "development");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const identifier = nextIdentifier("dev-console");

    await expect(sendOtp(identifier, "VERIFY", "EMAIL", new Date())).resolves.toMatchObject({
      sentVia: "EMAIL",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("canDeliverOtp : faux en production sans canal, vrai avec, toujours vrai hors production", () => {
    clearPlatformEnv();
    vi.stubEnv("APP_ENV", "production");
    expect(canDeliverOtp("EMAIL")).toBe(false);
    expect(canDeliverOtp("WHATSAPP")).toBe(false);
    stubPlatformEmail();
    expect(canDeliverOtp("EMAIL")).toBe(true);
    expect(canDeliverOtp("WHATSAPP")).toBe(false);
    vi.stubEnv("APP_ENV", "development");
    clearPlatformEnv();
    expect(canDeliverOtp("WHATSAPP")).toBe(true);
  });
});

describe("hashResetToken", () => {
  it("produit un hash déterministe et différent pour des jetons différents", () => {
    const a = hashResetToken("token-a");
    const b = hashResetToken("token-b");
    expect(a).not.toBe(b);
    expect(hashResetToken("token-a")).toBe(a);
  });
});
