import { describe, expect, it } from "vitest";
import { inspectionExpiryBounds, inspectionStatus, serviceStatus } from "./status";

const today = new Date("2026-10-18");
const days = (n: number) => new Date(today.getTime() + n * 24 * 60 * 60 * 1000);

describe("inspectionStatus — RG-M02-12", () => {
  it("UNKNOWN sans date", () => {
    expect(inspectionStatus(null, today)).toBe("UNKNOWN");
    expect(inspectionStatus(undefined, today)).toBe("UNKNOWN");
  });

  it("DUE_SOON à J-30 et OK à J-31 (borne exacte)", () => {
    expect(inspectionStatus(days(30), today)).toBe("DUE_SOON");
    expect(inspectionStatus(days(31), today)).toBe("OK");
  });

  it("DUE_SOON à J0 (expire aujourd'hui, pas encore expirée)", () => {
    expect(inspectionStatus(days(0), today)).toBe("DUE_SOON");
  });

  it("EXPIRED à J+1 (expirée depuis hier)", () => {
    expect(inspectionStatus(days(-1), today)).toBe("EXPIRED");
  });

  it("le jour J reste Bientôt même l'après-midi (date métier, pas l'heure)", () => {
    const afternoon = new Date("2026-10-30T14:46:00.000Z");
    const expiry = new Date("2026-10-30T00:00:00.000Z");
    expect(inspectionStatus(expiry, afternoon)).toBe("DUE_SOON");
    const { expiredBefore, dueSoonBefore } = inspectionExpiryBounds(afternoon);
    expect(expiry < expiredBefore).toBe(false);
    expect(expiry < dueSoonBefore).toBe(true);
    expect(inspectionStatus(new Date("2026-10-29T00:00:00.000Z"), afternoon)).toBe("EXPIRED");
  });

  it("inspectionExpiryBounds classe les mêmes dates que inspectionStatus", () => {
    const now = new Date("2026-10-18T15:30:00.000Z");
    const { expiredBefore, dueSoonBefore } = inspectionExpiryBounds(now);
    for (let offset = -5; offset <= 40; offset++) {
      const expiry = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
      const byRange =
        expiry < expiredBefore ? "EXPIRED" : expiry < dueSoonBefore ? "DUE_SOON" : "OK";
      expect(byRange).toBe(inspectionStatus(expiry, now));
    }
  });
});

describe("serviceStatus — §5", () => {
  it("UNKNOWN sans date ni km", () => {
    expect(serviceStatus(null, null, 50000, today)).toBe("UNKNOWN");
  });

  it("DUE_SOON à ≤ 30 j ou à ≤ 1000 km restants", () => {
    expect(serviceStatus(days(30), null, null, today)).toBe("DUE_SOON");
    expect(serviceStatus(null, 50000, 49000, today)).toBe("DUE_SOON");
    expect(serviceStatus(null, 50000, 48999, today)).toBe("OK");
  });

  it("OVERDUE si la date est dépassée ou le km atteint/dépassé", () => {
    expect(serviceStatus(days(-1), null, null, today)).toBe("OVERDUE");
    expect(serviceStatus(null, 50000, 50000, today)).toBe("OVERDUE");
    expect(serviceStatus(null, 50000, 50500, today)).toBe("OVERDUE");
  });

  it("OK au-delà des deux seuils", () => {
    expect(serviceStatus(days(31), 50000, 10000, today)).toBe("OK");
  });
});
