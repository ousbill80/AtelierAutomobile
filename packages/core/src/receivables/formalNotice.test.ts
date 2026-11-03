import { describe, expect, it } from "vitest";
import {
  formalNoticeDeadline,
  formalNoticeDeliveryError,
  formalNoticeFileName,
} from "./formalNotice";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("mise en demeure", () => {
  it("délai de paiement : 8 jours par défaut, au moins 1 jour", () => {
    expect(formalNoticeDeadline(d("2026-10-18"))).toEqual(d("2026-10-26"));
    expect(formalNoticeDeadline(d("2026-10-18"), 15)).toEqual(d("2026-11-02"));
    expect(formalNoticeDeadline(d("2026-10-18"), 0)).toEqual(d("2026-10-19"));
  });

  it("nom de fichier lisible, sans accents ni caractères spéciaux", () => {
    expect(formalNoticeFileName("SOTRA Logistique SARL", d("2026-10-18"))).toBe(
      "Mise-en-demeure-SOTRA-Logistique-SARL-2026-10-18.pdf",
    );
    expect(formalNoticeFileName("Koné & Fils — Garage", d("2026-11-02"))).toBe(
      "Mise-en-demeure-Kone-Fils-Garage-2026-11-02.pdf",
    );
  });

  it("date de remise : ni dans le futur, ni avant la mise en demeure", () => {
    const today = d("2026-11-02");
    expect(
      formalNoticeDeliveryError({ deliveredOn: d("2026-11-02"), issuedAt: d("2026-10-30"), today }),
    ).toBeNull();
    expect(
      formalNoticeDeliveryError({ deliveredOn: d("2026-11-03"), issuedAt: null, today }),
    ).toMatch(/futur/);
    expect(
      formalNoticeDeliveryError({ deliveredOn: d("2026-10-29"), issuedAt: d("2026-10-30"), today }),
    ).toMatch(/précéder/);
  });
});
