import { describe, expect, it } from "vitest";
import {
  canResendOtp,
  canSendOtp,
  checkOtpAttempt,
  computeOtpExpiry,
  countSendsInLastHour,
  OTP_MAX_SENDS_PER_HOUR_PER_IP,
} from "./otp";

describe("computeOtpExpiry — RG-M01-04", () => {
  it("expire 5 minutes après l'envoi", () => {
    const sentAt = new Date("2026-10-18T10:00:00Z");
    expect(computeOtpExpiry(sentAt)).toEqual(new Date("2026-10-18T10:05:00Z"));
  });
});

describe("checkOtpAttempt", () => {
  const expiresAt = new Date("2026-10-18T10:05:00Z");

  it("accepte une tentative avant expiration et sous le plafond d'essais", () => {
    expect(
      checkOtpAttempt({ expiresAt, attempts: 0, now: new Date("2026-10-18T10:01:00Z") }),
    ).toEqual({ status: "OK" });
  });

  it("refuse après expiration", () => {
    expect(
      checkOtpAttempt({ expiresAt, attempts: 0, now: new Date("2026-10-18T10:06:00Z") }),
    ).toEqual({ status: "EXPIRED" });
  });

  it("refuse au-delà de 3 essais", () => {
    expect(
      checkOtpAttempt({ expiresAt, attempts: 3, now: new Date("2026-10-18T10:01:00Z") }),
    ).toEqual({ status: "TOO_MANY_ATTEMPTS" });
  });
});

describe("canResendOtp — cadence 60 s", () => {
  it("autorise le premier envoi", () => {
    expect(canResendOtp(null, new Date("2026-10-18T10:00:00Z"))).toBe(true);
  });

  it("refuse avant 60 s", () => {
    const lastSentAt = new Date("2026-10-18T10:00:00Z");
    expect(canResendOtp(lastSentAt, new Date("2026-10-18T10:00:59Z"))).toBe(false);
  });

  it("autorise après 60 s", () => {
    const lastSentAt = new Date("2026-10-18T10:00:00Z");
    expect(canResendOtp(lastSentAt, new Date("2026-10-18T10:01:00Z"))).toBe(true);
  });
});

describe("countSendsInLastHour / canSendOtp — plafonds horaires", () => {
  const now = new Date("2026-10-18T11:00:00Z");

  it("ne compte que les envois dans l'heure glissante", () => {
    const sentAt = [
      new Date("2026-10-18T09:59:00Z"), // hors fenêtre
      new Date("2026-10-18T10:01:00Z"),
      new Date("2026-10-18T10:30:00Z"),
    ];
    expect(countSendsInLastHour(sentAt, now)).toBe(2);
  });

  it("refuse au-delà de 5 envois/heure par identifiant (défaut)", () => {
    const sentInLastHour = Array.from(
      { length: 5 },
      (_, i) => new Date(now.getTime() - i * 60_000),
    );
    expect(
      canSendOtp({
        lastSentAt: sentInLastHour[0]!,
        sentInLastHour,
        now: new Date(now.getTime() + 5 * 60_000),
      }),
    ).toBe(false);
  });

  it("autorise jusqu'à 10 envois/heure par IP", () => {
    const sentInLastHour = Array.from(
      { length: 9 },
      (_, i) => new Date(now.getTime() - i * 5 * 60_000),
    );
    expect(
      canSendOtp({
        lastSentAt: sentInLastHour[0]!,
        sentInLastHour,
        now: new Date(now.getTime() + 5 * 60_000),
        maxPerHour: OTP_MAX_SENDS_PER_HOUR_PER_IP,
      }),
    ).toBe(true);
  });
});
