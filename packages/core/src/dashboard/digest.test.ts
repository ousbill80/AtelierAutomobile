// Le 18/10/2026 est un dimanche (l’exemple RG-M12-30 du PRD indique « samedi »).
import { describe, expect, it } from "vitest";
import {
  buildDigestText,
  DIGEST_MAX_LENGTH,
  digestDedupeKey,
  isDigestDue,
  type DigestInput,
} from "./digest";

const input: DigestInput = {
  garageName: "Garage Excellence Auto",
  now: new Date("2026-10-18T07:30:00Z"),
  timeZone: "Africa/Abidjan",
  mode: "FULL",
  receivables: { total: 4_850_000, over30: 1_920_000 },
  promisesToday: { count: 2, amount: 310_000 },
  reminders: { toApprove: 23, failed: 3 },
  recovered: { yesterday: 185_000, last30Days: 2_300_000 },
  alerts: ["Écart de caisse −12 500 FCFA (Yopougon)"],
  link: "https://app.atelieros.ci/tableau-de-bord",
};

describe("buildDigestText (RG-M12-30)", () => {
  it("produit le format attendu", () => {
    expect(buildDigestText(input)).toBe(
      [
        "☀️ Garage Excellence Auto — dimanche 18/10/2026",
        "ARGENT DEHORS : 4 850 000 FCFA dont 1 920 000 à +30 j",
        "Promesses attendues aujourd'hui : 2 (310 000 FCFA)",
        "RELANCES : 23 à valider · 3 échecs d'envoi",
        "Récupéré grâce aux relances : 185 000 FCFA hier · 2 300 000 FCFA sur 30 j",
        "⚠️ Écart de caisse −12 500 FCFA (Yopougon)",
        "Détails : https://app.atelieros.ci/tableau-de-bord",
      ].join("\n"),
    );
  });

  it("omet les sections vides ; version REMINDERS_ONLY", () => {
    const text = buildDigestText({
      ...input,
      mode: "REMINDERS_ONLY",
      remindersOnly: { inspectionsDue30: 41, servicesDueThisMonth: 37 },
      receivables: null,
      promisesToday: { count: 0, amount: 0 },
      reminders: { toApprove: 0, failed: 0 },
      recovered: { yesterday: 0, last30Days: 0 },
      alerts: [],
    });
    expect(text.split("\n")).toEqual([
      "☀️ Garage Excellence Auto — dimanche 18/10/2026",
      "VT sous 30 j : 41 · Révisions dues ce mois : 37",
      "Détails : https://app.atelieros.ci/tableau-de-bord",
    ]);
  });

  it("reste sous 1 000 caractères en retirant les dernières alertes", () => {
    const text = buildDigestText({
      ...input,
      alerts: Array.from({ length: 40 }, (_, i) => `Alerte numéro ${i} un peu longue`),
    });
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_LENGTH);
    expect(text.endsWith("Détails : https://app.atelieros.ci/tableau-de-bord")).toBe(true);
  });

  it("clé de dédoublonnage et heure d'envoi", () => {
    expect(digestDedupeKey("m1", "2026-10-18")).toBe("digest:m1:2026-10-18");
    expect(isDigestDue(new Date("2026-10-18T07:29:00Z"), "Africa/Abidjan")).toBe(false);
    expect(isDigestDue(new Date("2026-10-18T07:30:00Z"), "Africa/Abidjan")).toBe(true);
    expect(isDigestDue(new Date("2026-10-18T07:30:00Z"), "Africa/Abidjan", "08:00")).toBe(false);
  });
});
