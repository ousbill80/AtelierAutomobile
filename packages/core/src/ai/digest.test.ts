import { describe, expect, it } from "vitest";
import { buildDigestText, type DigestInput } from "../dashboard/digest";
import { acceptDigestHighlight, digestHighlightFacts, hasDigestHighlightMaterial } from "./digest";

const NOW = new Date("2026-10-18T07:30:00Z");

function input(partial: Partial<DigestInput> = {}): DigestInput {
  return {
    garageName: "Garage Excellence Auto",
    now: NOW,
    timeZone: "Africa/Abidjan",
    mode: "FULL",
    receivables: { total: 4_850_000, over30: 1_920_000 },
    promisesToday: null,
    reminders: { toApprove: 23, failed: 3 },
    recovered: { yesterday: 185_000, last30Days: 2_300_000 },
    yesterday: { revenueHt: 1_245_000, collected: 980_000, byMethod: { WAVE: 520_000 } },
    orders: { opened: 9, delivered: 7, inProgress: 14 },
    today: { appointments: 11, promised: 5, blockedParts: 2 },
    alerts: ["Écart de caisse −12 500 FCFA (Yopougon) — Awa K."],
    link: "https://app.atelieros.ci/tableau-de-bord",
    ...partial,
  };
}

describe("RG-M17-21 — phrase « faits marquants »", () => {
  it("faits sans données personnelles (alertes réduites à leur nombre)", () => {
    const facts = digestHighlightFacts(input());
    expect(JSON.stringify(facts)).not.toContain("Awa");
    expect(JSON.stringify(facts)).not.toContain("Garage Excellence");
    expect(facts.alertsCount).toBe(1);
  });

  it("accepte une phrase dont les chiffres viennent des faits, refuse les chiffres inventés", () => {
    const facts = digestHighlightFacts(input());
    expect(
      acceptDigestHighlight(
        "Hier, record d'encaissement Wave (520 000 FCFA) ; 2 OR bloqués en attente de pièces > 48 h.",
        facts,
      ),
    ).toContain("record");
    expect(
      acceptDigestHighlight("1 920 000 FCFA de créances ont plus de 30 jours.", facts),
    ).not.toBeNull();
    expect(acceptDigestHighlight("Hier, 1 300 000 FCFA facturés.", facts)).toBeNull();
    expect(acceptDigestHighlight("x".repeat(201), facts)).toBeNull();
    expect(acceptDigestHighlight("   ", facts)).toBeNull();
    expect(acceptDigestHighlight(null, facts)).toBeNull();
  });

  it("rien de notable : pas d'appel au modèle", () => {
    const quiet = digestHighlightFacts(
      input({
        receivables: null,
        recovered: { yesterday: 0, last30Days: 0 },
        yesterday: { revenueHt: 0, collected: 0, byMethod: {} },
        orders: { opened: 0, delivered: 0, inProgress: 0 },
        alerts: [],
      }),
    );
    expect(hasDigestHighlightMaterial(quiet)).toBe(false);
    expect(hasDigestHighlightMaterial(digestHighlightFacts(input()))).toBe(true);
  });

  it("ligne 💡 avant le lien ; retirée en premier si le message dépasse 1 000 caractères", () => {
    const text = buildDigestText(input({ highlight: "Hier, record d'encaissement Wave." }));
    const lines = text.split("\n");
    expect(lines.at(-2)).toBe("💡 Hier, record d'encaissement Wave.");
    expect(lines.at(-1)).toBe("Détails : https://app.atelieros.ci/tableau-de-bord");
    expect(buildDigestText(input())).not.toContain("💡");
    const long = buildDigestText(
      input({
        alerts: Array.from({ length: 12 }, (_, i) => `Alerte ${i} ${"x".repeat(60)}`),
        highlight: "Phrase",
      }),
    );
    expect(long.length).toBeLessThanOrEqual(1000);
    expect(long).not.toContain("💡");
  });
});
