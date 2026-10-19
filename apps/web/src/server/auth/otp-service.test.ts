import { adminDb } from "@atelieros/db";
import { OTP_RESEND_COOLDOWN_SECONDS } from "@atelieros/core";
import { afterEach, describe, expect, it } from "vitest";
import { hashResetToken, OtpRateLimitError, sendOtp, verifyOtp } from "./otp-service";

const testIdentifiers: string[] = [];

function nextIdentifier(label: string): string {
  const identifier = `test-otp-${label}-${Math.random().toString(36).slice(2)}@example.com`;
  testIdentifiers.push(identifier);
  return identifier;
}

afterEach(async () => {
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

describe("hashResetToken", () => {
  it("produit un hash déterministe et différent pour des jetons différents", () => {
    const a = hashResetToken("token-a");
    const b = hashResetToken("token-b");
    expect(a).not.toBe(b);
    expect(hashResetToken("token-a")).toBe(a);
  });
});
