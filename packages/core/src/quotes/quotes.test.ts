import { describe, expect, it } from "vitest";
import { DomainError } from "../errors";
import { quoteContentPayload, isPreviewBot } from "./content";
import { decisionResult } from "./decision";
import { depositAmount, roundUpToHundred } from "./deposit";
import { discountAllowed, discountRequiresReason, globalDiscountRateEquivalent } from "./discount";
import { groupQuoteLines } from "./grouping";
import { insuranceGap, insuranceSplit } from "./insurance";
import { phoneConfirmationMessage, quoteSendMessage } from "./messages";
import { DEFAULT_DISCOUNT_CAPS, quoteSettingsFrom } from "./settings";
import { assertQuoteTransition, availableQuoteTransitions, canQuoteTransition } from "./stateMachine";
import { latestVersions, quoteStats, type QuoteStatsInput } from "./stats";
import { allocateGlobalDiscount, quoteLineAmounts, quoteTotals } from "./totals";
import type { QuoteLineLike } from "./types";
import { computeValidUntil, isQuoteExpired, portalLinkExpiry } from "./validity";

type L = QuoteLineLike & { id: string; description: string };

function line(partial: Partial<L> & { id: string; unitPrice: number }): L {
  return {
    description: partial.id,
    type: "LABOR",
    quantity: 1,
    discountRate: 0,
    vatRate: 18,
    payer: "CUSTOMER",
    isOptional: false,
    accepted: null,
    sortOrder: 0,
    ...partial,
  };
}

/** Exemple RG-M05-03 / US-M05-01. */
function prdLines(): L[] {
  return [
    line({ id: "l1", description: "MO plaquettes AV", quantity: 1, unitPrice: 15_000, groupKey: "g1", priority: "URGENT" }),
    line({ id: "l2", description: "Jeu de plaquettes AV", type: "PART", unitPrice: 28_000, groupKey: "g1", priority: "URGENT" }),
    line({ id: "l3", description: "MO amortisseurs AR", quantity: 2, unitPrice: 15_000, groupKey: "g2", priority: "WATCH", isOptional: true }),
    line({ id: "l4", description: "Amortisseurs AR", type: "PART", quantity: 2, unitPrice: 45_000, groupKey: "g2", priority: "WATCH", isOptional: true }),
    line({ id: "l5", description: "Balais d'essuie-glace", type: "PART", unitPrice: 8_000, groupKey: "g3", priority: "WATCH", isOptional: true }),
  ];
}

describe("quoteTotals (RG-M05-03)", () => {
  it("reproduit l'exemple du PRD : 201 780 TTC, accepté 60 180", () => {
    const lines = prdLines().map((l) => ({
      ...l,
      accepted: l.groupKey === "g1" || l.groupKey === "g3",
    }));
    const totals = quoteTotals(lines);
    expect(totals.subtotal).toBe(43_000 + 120_000 + 8_000);
    expect(totals.vatTotal).toBe(7_740 + 21_600 + 1_440);
    expect(totals.total).toBe(201_780);
    expect(totals.acceptedTotal).toBe(60_180);
    expect(totals.declinedTotal).toBe(141_600);
    expect(totals.discountTotal).toBe(0);
    expect(totals.customerShare).toBe(201_780);
    expect(totals.insuranceShare).toBe(0);
  });

  it("arrondit par ligne et désactive la TVA quand l'organisation n'y est pas assujettie", () => {
    const l = line({ id: "x", quantity: 2.5, unitPrice: 15_000, discountRate: 10 });
    expect(quoteLineAmounts(l)).toMatchObject({ gross: 37_500, lineSubtotal: 33_750, lineVat: 6_075, lineTotal: 39_825 });
    expect(quoteTotals([l], { vatEnabled: false }).total).toBe(33_750);
  });

  it("répartit la remise globale au prorata (100 000 / 50 000, remise 9 000 → 6 000 / 3 000)", () => {
    const lines = [line({ id: "a", unitPrice: 100_000 }), line({ id: "b", unitPrice: 50_000 })];
    const totals = quoteTotals(lines, { globalDiscountAmount: 9_000 });
    expect(totals.lines.map((l) => l.globalDiscount)).toEqual([6_000, 3_000]);
    expect(totals.discountTotal).toBe(9_000);
    expect(totals.subtotal).toBe(150_000);
    expect(totals.total).toBe(141_000 + Math.round(141_000 * 0.18));
  });

  it("accepte une remise globale en % et refuse rate + amount simultanés", () => {
    const lines = [line({ id: "a", unitPrice: 100_000 })];
    expect(quoteTotals(lines, { globalDiscountRate: 10 }).discountTotal).toBe(10_000);
    expect(() => quoteTotals(lines, { globalDiscountRate: 10, globalDiscountAmount: 5 })).toThrow(DomainError);
  });

  it("exclut les lignes garantie / interne du total client et de l'assiette de remise", () => {
    const lines = [
      line({ id: "a", unitPrice: 100_000 }),
      line({ id: "w", unitPrice: 50_000, payer: "WARRANTY" }),
    ];
    const totals = quoteTotals(lines, { globalDiscountAmount: 10_000 });
    expect(totals.total).toBe(90_000 + 16_200);
    expect(totals.lines[1]).toMatchObject({ lineTotal: 0, globalDiscount: 0 });
  });

  it("pièce fournie par le client : 0", () => {
    expect(quoteLineAmounts(line({ id: "p", type: "PART", unitPrice: 9_000, isCustomerSupplied: true })).lineTotal).toBe(0);
  });

  it("calcule la part assurance moins la franchise (RG-M05-13)", () => {
    const lines = [
      line({ id: "a", unitPrice: 1_000_000, payer: "INSURANCE" }),
      line({ id: "c", unitPrice: 50_000 }),
    ];
    const totals = quoteTotals(lines, { deductible: 100_000 });
    expect(totals.total).toBe(1_180_000 + 59_000);
    expect(totals.insuranceShare).toBe(1_080_000);
    expect(totals.customerShare).toBe(100_000 + 59_000);
  });
});

describe("allocateGlobalDiscount", () => {
  it("plus grand reste : tombe juste à l'unité", () => {
    expect(allocateGlobalDiscount([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(allocateGlobalDiscount([100_000, 50_000], 9_000)).toEqual([6_000, 3_000]);
  });
  it("borne chaque part à sa ligne et refuse une remise supérieure au total", () => {
    expect(allocateGlobalDiscount([10, 1_000], 1_000)).toEqual([10, 990]);
    expect(() => allocateGlobalDiscount([100, 50], 151)).toThrow(/supérieure/);
    expect(() => allocateGlobalDiscount([100], -1)).toThrow(DomainError);
    expect(allocateGlobalDiscount([], 0)).toEqual([]);
  });
});

describe("discountAllowed (RG-M05-07)", () => {
  it("ADVISOR : 10 % ligne / 5 % global", () => {
    expect(discountAllowed({ role: "ADVISOR", caps: DEFAULT_DISCOUNT_CAPS, lineRates: [10, 5] })).toEqual({ ok: true });
    expect(discountAllowed({ role: "ADVISOR", caps: DEFAULT_DISCOUNT_CAPS, lineRates: [15] })).toMatchObject({ ok: false, exceeded: "LINE", cap: 10, requested: 15 });
    expect(discountAllowed({ role: "ADVISOR", caps: DEFAULT_DISCOUNT_CAPS, lineRates: [], globalRate: 6 })).toMatchObject({ ok: false, exceeded: "GLOBAL", cap: 5 });
  });
  it("quote:discount_override → plafond OWNER ; rôle inconnu → 0 %", () => {
    expect(discountAllowed({ role: "ADVISOR", caps: DEFAULT_DISCOUNT_CAPS, lineRates: [40], hasOverride: true })).toEqual({ ok: true });
    expect(discountAllowed({ role: "CASHIER", caps: DEFAULT_DISCOUNT_CAPS, lineRates: [1] }).ok).toBe(false);
    expect(discountAllowed({ role: "UNKNOWN", caps: DEFAULT_DISCOUNT_CAPS, lineRates: [1] }).ok).toBe(false);
  });
  it("motif obligatoire au-delà de 5 % ; équivalent % d'un montant", () => {
    expect(discountRequiresReason([5], 0)).toBe(false);
    expect(discountRequiresReason([6], 0)).toBe(true);
    expect(discountRequiresReason([], 10)).toBe(true);
    expect(globalDiscountRateEquivalent(9_000, 150_000)).toBe(6);
    expect(globalDiscountRateEquivalent(1, 0)).toBe(100);
  });
});

describe("decisionResult (RG-M05-04 / RG-M05-11)", () => {
  it("accepté partiel par groupe : plaquettes + balais acceptés, amortisseurs refusés", () => {
    const result = decisionResult(prdLines(), [
      { groupKey: "g1", accepted: true },
      { groupKey: "g2", accepted: false, declineReason: "LATER" },
      { groupKey: "g3", accepted: true },
    ]);
    expect(result.status).toBe("PARTIALLY_ACCEPTED");
    expect(result.lines.find((l) => l.id === "l3")).toEqual({ id: "l3", accepted: false, declineReason: "LATER" });
    expect(result.lines.filter((l) => l.accepted).map((l) => l.id)).toEqual(["l1", "l2", "l5"]);
  });
  it("toutes acceptées → ACCEPTED, toutes refusées → DECLINED", () => {
    const lines = [line({ id: "a", unitPrice: 1 }), line({ id: "b", unitPrice: 1 })];
    expect(decisionResult(lines, [{ lineId: "a", accepted: true }, { lineId: "b", accepted: true }]).status).toBe("ACCEPTED");
    expect(decisionResult(lines, [{ lineId: "a", accepted: false }, { lineId: "b", accepted: false }]).status).toBe("DECLINED");
  });
  it("optionnelle non touchée → refusée ; non optionnelle non décidée → NON_OPTIONAL_UNDECIDED", () => {
    const lines = [line({ id: "a", unitPrice: 1 }), line({ id: "o", unitPrice: 1, isOptional: true })];
    const result = decisionResult(lines, [{ lineId: "a", accepted: true }]);
    expect(result.status).toBe("PARTIALLY_ACCEPTED");
    expect(result.lines.find((l) => l.id === "o")!.accepted).toBe(false);
    expect(() => decisionResult(lines, [{ lineId: "o", accepted: true }])).toThrow(/non optionnels/);
    try {
      decisionResult(lines, []);
    } catch (error) {
      expect((error as DomainError).code).toBe("NON_OPTIONAL_UNDECIDED");
    }
  });
  it("dépendance : l'enfant d'un groupe refusé est refusé (disques sans plaquettes)", () => {
    const lines = [
      line({ id: "p", unitPrice: 1, groupKey: "plaquettes" }),
      line({ id: "d", unitPrice: 1, groupKey: "disques", requiresGroupKey: "plaquettes", isOptional: true }),
    ];
    const result = decisionResult(lines, [
      { groupKey: "plaquettes", accepted: false },
      { groupKey: "disques", accepted: true },
    ]);
    expect(result.status).toBe("DECLINED");
    expect(result.lines.find((l) => l.id === "d")).toMatchObject({ accepted: false, declineReason: "REQUIRES_PARENT" });
  });
  it("décision par ligne côté personnel ; portail (byGroup) propage au groupe", () => {
    const lines = prdLines();
    const staff = decisionResult(lines, [{ lineId: "l1", accepted: true }, { lineId: "l2", accepted: false }]);
    expect(staff.lines.find((l) => l.id === "l2")!.accepted).toBe(false);
    const portal = decisionResult(lines, [{ lineId: "l1", accepted: true }], { byGroup: true });
    expect(portal.lines.find((l) => l.id === "l2")!.accepted).toBe(true);
  });
  it("amendement : uniquement refusé → accepté, le reste conservé", () => {
    const lines = prdLines().map((l) => ({ ...l, accepted: l.groupKey === "g1" }));
    const result = decisionResult(lines, [{ groupKey: "g2", accepted: true }, { groupKey: "g1", accepted: false }], { amendment: true });
    expect(result.status).toBe("PARTIALLY_ACCEPTED");
    expect(result.lines.find((l) => l.id === "l1")!.accepted).toBe(true);
    expect(result.lines.find((l) => l.id === "l3")!.accepted).toBe(true);
    expect(result.lines.find((l) => l.id === "l5")!.accepted).toBe(false);
  });
  it("groupe ou ligne inconnus, devis vide → erreurs", () => {
    expect(() => decisionResult(prdLines(), [{ groupKey: "nope", accepted: true }])).toThrow(DomainError);
    expect(() => decisionResult(prdLines(), [{ lineId: "nope", accepted: true }])).toThrow(DomainError);
    expect(() => decisionResult([], [])).toThrow(DomainError);
  });
});

describe("insurance (RG-M05-13)", () => {
  it("franchise 100 000 : part assurance 1 080 000, client 100 000", () => {
    expect(insuranceSplit({ insuranceLinesTotal: 1_180_000, total: 1_180_000, deductible: 100_000 })).toEqual({ insuranceShare: 1_080_000, customerShare: 100_000 });
    expect(insuranceSplit({ insuranceLinesTotal: 50_000, total: 50_000, deductible: 100_000 })).toEqual({ insuranceShare: 0, customerShare: 50_000 });
  });
  it("montant approuvé inférieur → écart et deux options", () => {
    expect(insuranceGap(1_080_000, 980_000)).toEqual({ gap: 100_000, options: ["COMMERCIAL_DISCOUNT", "CHARGE_CUSTOMER"] });
    expect(insuranceGap(1_080_000, null)).toEqual({ gap: 0, options: [] });
    expect(insuranceGap(1_080_000, 1_200_000).gap).toBe(0);
  });
});

describe("depositAmount (RG-M05-14)", () => {
  const rule = { thresholdTtc: 300_000, rate: 50 };
  it("850 000 → 425 000 ; sous le seuil → 0 ; arrondi à la centaine supérieure", () => {
    expect(depositAmount({ acceptedTotal: 850_000, rule })).toBe(425_000);
    expect(depositAmount({ acceptedTotal: 299_999, rule })).toBe(0);
    expect(depositAmount({ acceptedTotal: 300_001, rule })).toBe(150_100);
    expect(roundUpToHundred(0)).toBe(0);
  });
  it("pièces spéciales : au moins leur coût d'achat, même sous le seuil, jamais plus que le total", () => {
    expect(depositAmount({ acceptedTotal: 200_000, rule, specialPartsCost: 120_050 })).toBe(120_100);
    expect(depositAmount({ acceptedTotal: 100_000, rule: null, specialPartsCost: 150_000 })).toBe(100_000);
    expect(depositAmount({ acceptedTotal: 100_000, rule: null })).toBe(0);
  });
});

describe("quoteStats (RG-M05-16)", () => {
  function q(partial: Partial<QuoteStatsInput> & { number: string }): QuoteStatsInput {
    return { version: 1, status: "SENT", sentAt: new Date("2026-10-01T08:00:00Z"), decidedAt: null, total: 0, acceptedTotal: 0, ...partial };
  }
  it("exemple : 40 clos, 26 acceptés → 65 % ; 4 850 000 / 3 120 000 → 64 %", () => {
    const quotes: QuoteStatsInput[] = [];
    for (let i = 0; i < 26; i++) quotes.push(q({ number: `A${i}`, status: "ACCEPTED", total: 120_000, acceptedTotal: 120_000, decidedAt: new Date("2026-10-02T08:00:00Z") }));
    for (let i = 0; i < 10; i++) quotes.push(q({ number: `D${i}`, status: "DECLINED", total: 100_000, declineReason: "TOO_EXPENSIVE", decidedAt: new Date("2026-10-03T08:00:00Z") }));
    for (let i = 0; i < 4; i++) quotes.push(q({ number: `E${i}`, status: "EXPIRED", total: 182_500 }));
    quotes.push(q({ number: "P1", status: "VIEWED", total: 999_999 }));
    quotes.push(q({ number: "N1", status: "DRAFT", sentAt: null, total: 1 }));
    const stats = quoteStats(quotes);
    expect(stats.closed).toBe(40);
    expect(stats.acceptedCount).toBe(26);
    expect(stats.rateCount).toBe(65);
    expect(stats.proposedAmount).toBe(4_850_000);
    expect(stats.acceptedAmount).toBe(3_120_000);
    expect(stats.rateValue).toBe(64);
    expect(stats.sent).toBe(41);
    expect(stats.medianDecisionHours).toBe(24);
    expect(stats.declineReasons).toEqual([{ reason: "TOO_EXPENSIVE", count: 10 }]);
  });
  it("ne compte que la dernière version de chaque numéro et attribue les relances", () => {
    const stats = quoteStats([
      q({ number: "X", version: 1, status: "EXPIRED", total: 100 }),
      q({ number: "X", version: 2, status: "ACCEPTED", total: 100, acceptedTotal: 100, followedUp: true, advisorId: "m1", advisorName: "Awa" }),
    ]);
    expect(stats.closed).toBe(1);
    expect(stats.rateCount).toBe(100);
    expect(stats.recoveredByFollowups).toBe(100);
    expect(stats.byAdvisor).toEqual([{ key: "m1", label: "Awa", sent: 1, accepted: 1, rateCount: 100 }]);
    expect(latestVersions([{ number: "X", version: 2 }, { number: "X", version: 1 }])).toEqual([{ number: "X", version: 2 }]);
    expect(quoteStats([]).medianDecisionHours).toBeNull();
  });
});

describe("contenu signé et robots", () => {
  const a = { id: "a", type: "LABOR" as const, description: "MO", quantity: 1, unitPrice: 10, discountRate: 0, vatRate: 18, payer: "CUSTOMER" as const };
  const b = { ...a, id: "b", description: "Pièce" };
  it("stable quel que soit l'ordre, sensible au prix", () => {
    expect(quoteContentPayload([a, b], 100)).toBe(quoteContentPayload([b, a], 100));
    expect(quoteContentPayload([a, b], 100)).not.toBe(quoteContentPayload([{ ...a, unitPrice: 11 }, b], 100));
    expect(quoteContentPayload([a], 10)).toContain("#total=10");
  });
  it("isPreviewBot", () => {
    expect(isPreviewBot("WhatsApp/2.23.20 A")).toBe(true);
    expect(isPreviewBot("facebookexternalhit/1.1")).toBe(true);
    expect(isPreviewBot("Mozilla/5.0 (Linux; Android 10) Chrome/118 Mobile Safari")).toBe(false);
    expect(isPreviewBot(null)).toBe(false);
  });
});

describe("validité, machine à états, paramètres", () => {
  const settings = { validityDays: 15, validityDaysCompany: 30 };
  it("15 jours particulier, 30 entreprise ou sinistre ; expiration stricte ; lien +30 j", () => {
    const created = new Date("2026-10-19T00:00:00Z");
    expect(computeValidUntil({ createdOn: created, settings, customerType: "INDIVIDUAL" }).toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(computeValidUntil({ createdOn: created, settings, customerType: "COMPANY" }).toISOString().slice(0, 10)).toBe("2026-11-18");
    expect(computeValidUntil({ createdOn: created, settings, customerType: "INDIVIDUAL", isInsurance: true }).toISOString().slice(0, 10)).toBe("2026-11-18");
    const validUntil = new Date("2026-11-03T00:00:00Z");
    expect(isQuoteExpired(validUntil, new Date("2026-11-03T00:00:00Z"))).toBe(false);
    expect(isQuoteExpired(validUntil, new Date("2026-11-04T00:00:00Z"))).toBe(true);
    expect(portalLinkExpiry(validUntil).toISOString().slice(0, 10)).toBe("2026-12-03");
  });
  it("transitions autorisées et refusées", () => {
    expect(canQuoteTransition("DRAFT", "send")).toBe(true);
    expect(canQuoteTransition("SENT", "send")).toBe(false);
    expect(canQuoteTransition("VIEWED", "decide")).toBe(true);
    expect(canQuoteTransition("ACCEPTED", "decide")).toBe(false);
    expect(canQuoteTransition("EXPIRED", "reactivate")).toBe(true);
    expect(canQuoteTransition("PARTIALLY_ACCEPTED", "convert")).toBe(true);
    expect(canQuoteTransition("SENT", "delete")).toBe(false);
    expect(() => assertQuoteTransition("CONVERTED", "edit")).toThrow(DomainError);
    expect(availableQuoteTransitions("DRAFT")).toEqual(["send", "decide", "delete"]);
  });
  it("quoteSettingsFrom : défauts et surcharges partielles", () => {
    const d = quoteSettingsFrom({});
    expect(d.validityDays).toBe(15);
    expect(d.requireSignature).toBe(true);
    expect(d.depositRule).toBeNull();
    expect(d.discountCaps.ADVISOR).toEqual({ line: 10, global: 5 });
    const s = quoteSettingsFrom({
      quotes: { validityDays: 10, depositRule: { thresholdTtc: 300_000, rate: 50 }, discountCaps: { ADVISOR: { line: 12 } }, requireSignature: false },
    });
    expect(s.validityDays).toBe(10);
    expect(s.depositRule).toEqual({ thresholdTtc: 300_000, rate: 50 });
    expect(s.discountCaps.ADVISOR).toEqual({ line: 12, global: 5 });
    expect(s.requireSignature).toBe(false);
    expect(quoteSettingsFrom({ quotes: { depositRule: { rate: 0 } } }).depositRule).toBeNull();
  });
});

describe("groupes et messages", () => {
  it("groupe MO + pièces, trié Urgent → À surveiller → autres", () => {
    const lines = [
      line({ id: "z", description: "Vidange", unitPrice: 1, sortOrder: 0 }),
      ...prdLines().map((l, i) => ({ ...l, sortOrder: i + 1 })),
    ];
    const groups = groupQuoteLines(lines, lines.map((_, i) => i * 10));
    expect(groups.map((g) => g.key)).toEqual(["g1", "g2", "g3", "line:z"]);
    expect(groups[0]!.lines.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(groups[0]!.total).toBe(10 + 20);
    expect(groups[1]!.isOptional).toBe(true);
    expect(groups[0]!.label).toBe("MO plaquettes AV");
  });
  it("messages pré-rédigés", () => {
    const msg = quoteSendMessage({ customerName: "M. Kouassi", number: "DEV-YOP-2026-00017", vehicleLabel: "Toyota Corolla (2547 GH 01)", total: 201_780, urgentTotal: 50_740, link: "https://x/p/t/devis", garageName: "Garage Excellence Auto" });
    expect(msg).toContain("DEV-YOP-2026-00017");
    expect(msg).toContain("201 780 FCFA TTC (dont 50 740 FCFA urgents)");
    expect(msg).toContain("https://x/p/t/devis");
    expect(quoteSendMessage({ customerName: "X", number: "N", vehicleLabel: null, total: 10, urgentTotal: 0, link: "l", garageName: "G" })).not.toContain("urgents");
    const conf = phoneConfirmationMessage({ time: "10:15", accepted: [{ label: "Plaquettes avant", total: 50_740 }], declined: [{ label: "Amortisseurs arrière" }, { label: "Balais" }] });
    expect(conf).toBe("Suite à notre appel de 10:15, vous avez accepté : Plaquettes avant (50 740 FCFA TTC). Refusé : Amortisseurs arrière, Balais. Si ce n'est pas correct, répondez à ce message.");
  });
});
