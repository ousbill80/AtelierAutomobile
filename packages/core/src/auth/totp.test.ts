import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  buildTotpUri,
  createTotpSecret,
  hotpCode,
  totpCode,
  totpStep,
  verifyTotp,
} from "./totp";

// Secret de référence des RFC 4226/6238 : "12345678901234567890" (ASCII).
const RFC_SECRET_BYTES = new TextEncoder().encode("12345678901234567890");
const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
  it("encodes the RFC secret", () => {
    expect(base32Encode(RFC_SECRET_BYTES)).toBe(RFC_SECRET_BASE32);
  });

  it("round-trips arbitrary bytes, including lengths not multiple of 5", () => {
    for (const length of [1, 2, 3, 4, 5, 7, 20, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("decodes lowercase, spaces and padding", () => {
    expect(Array.from(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq=="))).toEqual(
      Array.from(RFC_SECRET_BYTES),
    );
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("ABC1")).toThrow();
  });
});

describe("hotpCode (RFC 4226 appendix D)", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676"];
  expected.forEach((code, counter) => {
    it(`counter ${counter} → ${code}`, () => {
      expect(hotpCode(RFC_SECRET_BYTES, counter)).toBe(code);
    });
  });
});

describe("totpCode (RFC 6238 appendix B, SHA1, 6 digits)", () => {
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [seconds, code] of vectors) {
    it(`t=${seconds} → ${code}`, () => {
      expect(totpCode(RFC_SECRET_BASE32, new Date(seconds * 1000))).toBe(code);
    });
  }
});

describe("verifyTotp", () => {
  const now = new Date(1234567890 * 1000);

  it("accepts the current code", () => {
    expect(verifyTotp({ secretBase32: RFC_SECRET_BASE32, code: "005924", now })).toEqual({
      status: "OK",
      step: totpStep(now),
    });
  });

  it("tolerates one step of clock drift either way, not two", () => {
    const prev = totpCode(RFC_SECRET_BASE32, new Date(now.getTime() - 30_000));
    const next = totpCode(RFC_SECRET_BASE32, new Date(now.getTime() + 30_000));
    const tooOld = totpCode(RFC_SECRET_BASE32, new Date(now.getTime() - 60_000));
    expect(verifyTotp({ secretBase32: RFC_SECRET_BASE32, code: prev, now }).status).toBe("OK");
    expect(verifyTotp({ secretBase32: RFC_SECRET_BASE32, code: next, now }).status).toBe("OK");
    expect(verifyTotp({ secretBase32: RFC_SECRET_BASE32, code: tooOld, now }).status).toBe(
      "INVALID_CODE",
    );
  });

  it("refuses a code whose step was already used (replay)", () => {
    const step = totpStep(now);
    expect(
      verifyTotp({ secretBase32: RFC_SECRET_BASE32, code: "005924", now, lastUsedStep: step })
        .status,
    ).toBe("ALREADY_USED");
    expect(
      verifyTotp({ secretBase32: RFC_SECRET_BASE32, code: "005924", now, lastUsedStep: step - 1 })
        .status,
    ).toBe("OK");
  });

  it("accepts spaces in the typed code", () => {
    expect(verifyTotp({ secretBase32: RFC_SECRET_BASE32, code: "005 924", now }).status).toBe("OK");
  });

  it("rejects malformed and wrong codes", () => {
    for (const code of ["", "12345", "1234567", "abcdef", "000000"]) {
      expect(verifyTotp({ secretBase32: RFC_SECRET_BASE32, code, now }).status).toBe(
        "INVALID_CODE",
      );
    }
  });
});

describe("createTotpSecret", () => {
  it("returns a 32-char base32 secret for 20 random bytes", () => {
    const secret = createTotpSecret(new Uint8Array(20).fill(7));
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("refuses a secret shorter than 160 bits", () => {
    expect(() => createTotpSecret(new Uint8Array(10))).toThrow();
  });
});

describe("buildTotpUri", () => {
  it("builds an otpauth URI with issuer and encoded label", () => {
    const uri = buildTotpUri({
      secretBase32: RFC_SECRET_BASE32,
      accountLabel: "konan@garage.ci",
    });
    expect(uri.startsWith("otpauth://totp/AtelierOS%3Akonan%40garage.ci?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe(RFC_SECRET_BASE32);
    expect(params.get("issuer")).toBe("AtelierOS");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });
});
