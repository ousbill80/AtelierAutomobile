import { describe, expect, it } from "vitest";
import { smsSegments, transliterate, isGsm7, nonGsmChars } from "./smsSegments";

describe("smsSegments", () => {
  it("compte 1 segment GSM-7 pour 160 caractères", () => {
    const text = "a".repeat(160);
    expect(smsSegments(text)).toEqual({
      encoding: "GSM7",
      chars: 160,
      segments: 1,
      nonGsmChars: [],
    });
  });

  it("passe à 2 segments GSM-7 à 161 caractères (153 par segment au-delà)", () => {
    const text = "a".repeat(161);
    const result = smsSegments(text);
    expect(result.encoding).toBe("GSM7");
    expect(result.segments).toBe(2);
  });

  it("153 × 2 = 306 caractères → 2 segments GSM-7 exactement", () => {
    const text = "a".repeat(306);
    expect(smsSegments(text).segments).toBe(2);
  });

  it("compte les caractères d'extension GSM (€) pour 2 unités", () => {
    const text = "€".repeat(80); // 160 unités GSM-7
    const result = smsSegments(text);
    expect(result.encoding).toBe("GSM7");
    expect(result.chars).toBe(160);
    expect(result.segments).toBe(1);
  });

  it("1 segment UCS-2 pour 70 caractères non-GSM", () => {
    const text = "ê".repeat(70);
    expect(smsSegments(text)).toEqual({
      encoding: "UCS2",
      chars: 70,
      segments: 1,
      nonGsmChars: ["ê"],
    });
  });

  it("passe à 2 segments UCS-2 à 71 caractères (67 par segment au-delà)", () => {
    const text = "ê".repeat(71);
    const result = smsSegments(text);
    expect(result.encoding).toBe("UCS2");
    expect(result.segments).toBe(2);
  });

  it("accents français courants (é è à ù ì ò É Ç) sont GSM-7", () => {
    const text = "Règlement à régler : é è à ù ì ò É Ç";
    expect(isGsm7(text)).toBe(true);
  });

  it("ê â î ô û ç ë ï œ « » ' … ne sont pas GSM-7", () => {
    for (const char of ["ê", "â", "î", "ô", "û", "ç", "ë", "ï", "œ", "«", "»", "’", "…"]) {
      expect(isGsm7(char)).toBe(false);
      expect(nonGsmChars(char)).toEqual([char]);
    }
  });

  it("translitère les caractères non-GSM courants (les caractères GSM-7 comme é restent inchangés)", () => {
    expect(transliterate("Règlement rêvé à l’atelier « officiel »…")).toBe(
      'Règlement revé à l\'atelier " officiel "...',
    );
  });
});
