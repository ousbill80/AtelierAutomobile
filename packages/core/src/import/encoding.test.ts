import { describe, expect, it } from "vitest";
import { decodeBytes, detectEncoding } from "./encoding";

function bytesOf(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("detectEncoding", () => {
  it("détecte le BOM UTF-8", () => {
    const bytes = bytesOf([0xef, 0xbb, 0xbf, 0x41]);
    expect(detectEncoding(bytes)).toBe("UTF-8-BOM");
  });

  it("détecte le BOM UTF-16LE", () => {
    const bytes = bytesOf([0xff, 0xfe, 0x41, 0x00]);
    expect(detectEncoding(bytes)).toBe("UTF-16LE");
  });

  it("détecte le BOM UTF-16BE", () => {
    const bytes = bytesOf([0xfe, 0xff, 0x00, 0x41]);
    expect(detectEncoding(bytes)).toBe("UTF-16BE");
  });

  it("détecte l'UTF-8 valide sans BOM", () => {
    const bytes = new TextEncoder().encode("Côte d'Ivoire");
    expect(detectEncoding(bytes)).toBe("UTF-8");
  });

  it("détecte Windows-1252 pour un texte français mal encodé", () => {
    // "é" en Windows-1252 = 0xE9, octet invalide en UTF-8 strict seul.
    const bytes = bytesOf([0x43, 0xf4, 0x74, 0x65]); // "Côte" avec ô en 0xF4 (Windows-1252)
    expect(detectEncoding(bytes)).toBe("WINDOWS-1252");
  });

  it("retombe sur ISO-8859-1 si plus de 1% de codepoints non définis en Windows-1252", () => {
    // Octets 0x81 et 0x8D ne sont jamais utilisés en français : leur présence
    // après décodage Windows-1252 trahit un fichier en réalité ISO-8859-1.
    const bytes = bytesOf([0x81, 0x8d, 0x41, 0x42]);
    expect(detectEncoding(bytes)).toBe("ISO-8859-1");
  });

  it("respecte l'encodage forcé par l'utilisateur sans relancer la détection", () => {
    const bytes = new TextEncoder().encode("texte quelconque");
    expect(detectEncoding(bytes, "ISO-8859-1")).toBe("ISO-8859-1");
  });
});

describe("decodeBytes", () => {
  it("retire le BOM UTF-8 résiduel", () => {
    const bytes = bytesOf([0xef, 0xbb, 0xbf, 0x41, 0x42]);
    expect(decodeBytes(bytes, "UTF-8-BOM")).toBe("AB");
  });

  it("décode l'UTF-8 standard", () => {
    const bytes = new TextEncoder().encode("Côte d'Ivoire");
    expect(decodeBytes(bytes, "UTF-8")).toBe("Côte d'Ivoire");
  });

  it("décode Windows-1252", () => {
    const bytes = bytesOf([0x43, 0xf4, 0x74, 0x65]);
    expect(decodeBytes(bytes, "WINDOWS-1252")).toBe("Côte");
  });

  it("décode ISO-8859-1", () => {
    const bytes = bytesOf([0x43, 0xe9]);
    expect(decodeBytes(bytes, "ISO-8859-1")).toBe("Cé");
  });

  it("décode UTF-16LE", () => {
    const bytes = bytesOf([0x41, 0x00, 0x42, 0x00]);
    expect(decodeBytes(bytes, "UTF-16LE")).toBe("AB");
  });

  it("décode UTF-16BE", () => {
    const bytes = bytesOf([0x00, 0x41, 0x00, 0x42]);
    expect(decodeBytes(bytes, "UTF-16BE")).toBe("AB");
  });
});
