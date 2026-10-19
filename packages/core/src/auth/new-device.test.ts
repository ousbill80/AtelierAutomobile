import { describe, expect, it } from "vitest";
import { computeTrustedDeviceExpiry, requiresNewDeviceOtp } from "./new-device";

describe("requiresNewDeviceOtp (RG-M01-07)", () => {
  it("exige un OTP par défaut pour OWNER et ACCOUNTANT", () => {
    expect(requiresNewDeviceOtp(undefined, "OWNER")).toBe(true);
    expect(requiresNewDeviceOtp(undefined, "ACCOUNTANT")).toBe(true);
  });

  it("n'exige pas d'OTP par défaut pour les autres rôles", () => {
    expect(requiresNewDeviceOtp(undefined, "MECHANIC")).toBe(false);
    expect(requiresNewDeviceOtp(null, "ADVISOR")).toBe(false);
  });

  it("respecte une configuration explicite de l'organisation", () => {
    expect(requiresNewDeviceOtp({ otpOnNewDevice: ["MANAGER"] }, "MANAGER")).toBe(true);
    expect(requiresNewDeviceOtp({ otpOnNewDevice: ["MANAGER"] }, "OWNER")).toBe(false);
    expect(requiresNewDeviceOtp({ otpOnNewDevice: [] }, "OWNER")).toBe(false);
  });
});

describe("computeTrustedDeviceExpiry (RG-M01-07)", () => {
  it("approuve l'appareil pour 90 jours", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiry = computeTrustedDeviceExpiry(now);
    expect(expiry.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});
