import { describe, expect, it } from "vitest";
import { encodeSms } from "./smsEncoding";

const bytes = (data: Uint8Array) => [...data];

describe("encodeSms — choix de l'alphabet", () => {
  it("GSM-7 : codes GSM 03.38 (et non ASCII) pour @, $, _, é, à", () => {
    const sms = encodeSms("A@$_éà ¡");
    expect(sms.encoding).toBe("GSM7");
    expect(sms.dataCoding).toBe(0);
    expect(sms.concatenated).toBe(false);
    expect(bytes(sms.segments[0]!)).toEqual([0x41, 0x00, 0x02, 0x11, 0x05, 0x7f, 0x20, 0x40]);
  });

  it("GSM-7 : É et Æ après le trou de l'échappement 0x1B", () => {
    expect(bytes(encodeSms("ÆÉ").segments[0]!)).toEqual([0x1c, 0x1f]);
  });

  it("GSM-7 étendu : € et [ précédés de l'échappement 0x1B", () => {
    expect(bytes(encodeSms("€[").segments[0]!)).toEqual([0x1b, 0x65, 0x1b, 0x3c]);
  });

  it("caractère hors GSM (ç, ê) → UCS-2 big-endian, data_coding 8", () => {
    const sms = encodeSms("çê");
    expect(sms.encoding).toBe("UCS2");
    expect(sms.dataCoding).toBe(8);
    expect(bytes(sms.segments[0]!)).toEqual([0x00, 0xe7, 0x00, 0xea]);
  });

  it("emoji → paire de substitution UCS-2 (4 octets)", () => {
    expect(bytes(encodeSms("🚗").segments[0]!)).toEqual([0xd8, 0x3d, 0xde, 0x97]);
  });

  it("Latin-1 : data_coding 3, octets ISO-8859-1", () => {
    const sms = encodeSms("Révision à 9h", { defaultAlphabet: "latin1" });
    expect(sms.encoding).toBe("LATIN1");
    expect(sms.dataCoding).toBe(3);
    expect(bytes(sms.segments[0]!)).toEqual([...Buffer.from("Révision à 9h", "latin1")]);
  });

  it("Latin-1 : € (hors Latin-1) bascule en UCS-2", () => {
    expect(encodeSms("5 €", { defaultAlphabet: "latin1" }).encoding).toBe("UCS2");
  });

  it("texte vide : un segment vide", () => {
    const sms = encodeSms("");
    expect(sms.segments).toHaveLength(1);
    expect(sms.segments[0]!.length).toBe(0);
  });
});

describe("encodeSms — segmentation", () => {
  it("GSM-7 : 160 caractères = 1 SMS sans en-tête", () => {
    const sms = encodeSms("a".repeat(160));
    expect(sms.concatenated).toBe(false);
    expect(sms.segments[0]!.length).toBe(160);
  });

  it("GSM-7 : 161 caractères = 2 segments de 153 + 8, avec UDH 05 00 03 ref total n°", () => {
    const sms = encodeSms("a".repeat(161), { reference: 0x2a });
    expect(sms.concatenated).toBe(true);
    expect(sms.segments).toHaveLength(2);
    expect(bytes(sms.segments[0]!.slice(0, 6))).toEqual([0x05, 0x00, 0x03, 0x2a, 2, 1]);
    expect(bytes(sms.segments[1]!.slice(0, 6))).toEqual([0x05, 0x00, 0x03, 0x2a, 2, 2]);
    expect(sms.segments[0]!.length).toBe(6 + 153);
    expect(sms.segments[1]!.length).toBe(6 + 8);
  });

  it("GSM-7 : l'échappement d'un caractère étendu n'est jamais coupé entre deux segments", () => {
    const sms = encodeSms("a".repeat(152) + "€" + "a".repeat(10));
    const first = sms.segments[0]!.slice(6);
    expect(first.length).toBe(152);
    expect(bytes(sms.segments[1]!.slice(6, 8))).toEqual([0x1b, 0x65]);
  });

  it("UCS-2 : 70 caractères = 1 SMS, 71 = 2 segments de 67 + 4", () => {
    expect(encodeSms("ç".repeat(70)).segments).toHaveLength(1);
    const sms = encodeSms("ç".repeat(71));
    expect(sms.segments).toHaveLength(2);
    expect(sms.segments[0]!.length).toBe(6 + 134);
    expect(sms.segments[1]!.length).toBe(6 + 8);
  });

  it("UCS-2 : une paire de substitution n'est jamais coupée", () => {
    const sms = encodeSms("ç".repeat(66) + "🚗" + "ççç");
    expect(sms.segments[0]!.length).toBe(6 + 132);
    expect(bytes(sms.segments[1]!.slice(6, 10))).toEqual([0xd8, 0x3d, 0xde, 0x97]);
  });

  it("référence ramenée sur un octet", () => {
    expect(encodeSms("a".repeat(200), { reference: 0x1ff }).segments[0]![3]).toBe(0xff);
  });
});
