import { describe, expect, it } from "vitest";
import {
  allocateGlobalDiscount,
  amendDecision,
  canonicalQuoteContent,
  canQuoteTransition,
  checkDiscounts,
  clampRates,
  DEFAULT_DISCOUNT_CAPS,
  defaultValidUntil,
  DEFAULT_QUOTE_SETTINGS,
  decisionResult,
  depositAmount,
  diffQuoteVersions,
  groupQuoteLines,
  insuranceApprovalGap,
  insuranceSplit,
  isPreviewBot,
  laborHoursForVehicle,
  phoneConfirmationMessage,
  portalLinkExpiry,
  quoteSendMessage,
  quoteSettingsFrom,
  quoteStats,
  quoteTotals,
  sendBlockers,
  shouldExpire,
  signatureRequired,
  type QuoteLineLike,
  type QuoteStatsInput,
} from "./index";

function line(partial: Partial<QuoteLineLike> & { id: string; unitPrice: number }): QuoteLineLike {
  return {
    type: "LABOR",
    description: partial.id,
    quantity: 1,
    discountRate: 0,
    vatRate: 18,
    payer: "CUSTOMER",
    ...partial,
  };
}

/** Exemple US-M05-01 / RG-M05-03. */
const example: QuoteLineLike[] = [
  line({
    id: "p-mo",
    unitPrice: 15_000,
    groupKey: "pads",
    groupLabel: "Plaquettes avant",
    priority: "URGENT",
    sortOrder: 0,
  }),
  line({
    id: "p-part",
    type: "PART",
    unitPrice: 28_000,
    groupKey: "pads",
    groupLabel: "Plaquettes avant",
    priority: "URGENT",
    sortOrder: 1,
  }),
  line({
    id: "a-mo",
    quantity: 2,
    unitPrice: 15_000,
    groupKey: "shocks",
    groupLabel: "Amortisseurs arrière",
    priority: "WATCH",
    isOptional: true,
    sortOrder: 2,
  }),
  line({
    id: "a-part",
    type: "PART",
    quantity: 2,
    unitPrice: 45_000,
    groupKey: "shocks",
    groupLabel: "Amortisseurs arrière",
    priority: "WATCH",
    isOptional: true,
    sortOrder: 3,
  }),
  line({
    id: "w",
    type: "PART",
    unitPrice: 8_000,
    groupKey: "wipers",
    groupLabel: "Balais d'essuie-glace",
    priority: "WATCH",
    isOptional: true,
    sortOrder: 4,
  }),
];

describe("quoteTotals (RG-M05-03)", () => {
  it("exemple du PRD : 201 780 TTC, accepté 60 180", () => {
    const accepted = example.map((l) => ({ ...l, accepted: l.groupKey !== "shocks" }));
    const t = quoteTotals(accepted);
    expect(t.subtotal).toBe(171_000);
    expect(t.vatTotal).toBe(30_780);
    expect(t.total).toBe(201_780);
    expect(t.acceptedTotal).toBe(60_180);
    expect(t.declinedTotal).toBe(141_600);
    expect(t.discountTotal).toBe(0);
    expect(t.customerShare).toBe(201_780);
  });

  it("arrondit la TVA par ligne", () => {
    const t = quoteTotals([
      line({ id: "a", unitPrice: 1_001 }),
      line({ id: "b", unitPrice: 1_001 }),
    ]);
    // 1 001 × 18 % = 180,18 → 180 par ligne
    expect(t.lines.map((l) => l.vat)).toEqual([180, 180]);
    expect(t.total).toBe(2_362);
  });

  it("TVA désactivée", () => {
    const t = quoteTotals(example, { vatEnabled: false });
    expect(t.vatTotal).toBe(0);
    expect(t.total).toBe(171_000);
  });

  it("remise de ligne puis remise globale répartie, TVA recalculée", () => {
    const t = quoteTotals(
      [line({ id: "a", unitPrice: 100_000 }), line({ id: "b", unitPrice: 50_000 })],
      { globalDiscountAmount: 9_000 },
    );
    expect(t.lines.map((l) => l.globalDiscount)).toEqual([6_000, 3_000]);
    expect(t.lines.map((l) => l.subtotal)).toEqual([94_000, 47_000]);
    expect(t.vatTotal).toBe(16_920 + 8_460);
    expect(t.discountTotal).toBe(9_000);
    expect(t.total).toBe(150_000 - 9_000 + 25_380);
    expect(t.globalDiscountRateEffective).toBe(6);
  });

  it("remise globale en % et remise de ligne", () => {
    const t = quoteTotals([line({ id: "a", unitPrice: 100_000, discountRate: 10 })], {
      globalDiscountRate: 5,
    });
    expect(t.lines[0]!.lineDiscount).toBe(10_000);
    expect(t.lines[0]!.globalDiscount).toBe(4_500);
    expect(t.discountTotal).toBe(14_500);
  });

  it("garantie / interne exclues, pièce fournie par le client à 0", () => {
    const t = quoteTotals([
      line({ id: "a", unitPrice: 10_000 }),
      line({ id: "b", unitPrice: 50_000, payer: "WARRANTY" }),
      line({ id: "c", type: "PART", unitPrice: 30_000, isCustomerSupplied: true }),
    ]);
    expect(t.total).toBe(11_800);
    expect(t.lines[1]!.billable).toBe(false);
    expect(t.lines[2]!.total).toBe(0);
  });

  it("part assurance et franchise (US-M05-13)", () => {
    const t = quoteTotals([line({ id: "body", unitPrice: 1_000_000, payer: "INSURANCE" })], {
      deductible: 100_000,
    });
    expect(t.total).toBe(1_180_000);
    expect(t.insuranceShare).toBe(1_080_000);
    expect(t.customerShare).toBe(100_000);
  });
});

describe("allocateGlobalDiscount", () => {
  it("prorata exact", () => {
    expect(allocateGlobalDiscount([100_000, 50_000], 9_000)).toEqual([6_000, 3_000]);
  });
  it("plus grand reste : la somme tombe juste", () => {
    const shares = allocateGlobalDiscount([1, 1, 1], 2);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(2);
    expect(shares).toEqual([1, 1, 0]);
    const s2 = allocateGlobalDiscount([333, 333, 334], 100);
    expect(s2.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("bornée à la valeur des lignes", () => {
    expect(allocateGlobalDiscount([10, 5], 15)).toEqual([10, 5]);
    expect(() => allocateGlobalDiscount([10, 5], 16)).toThrow(
      "Remise supérieure au montant des lignes.",
    );
  });
  it("zéro et montant négatif", () => {
    expect(allocateGlobalDiscount([10, 5], 0)).toEqual([0, 0]);
    expect(() => allocateGlobalDiscount([10], -1)).toThrow();
  });
});

describe("checkDiscounts (RG-M05-07)", () => {
  it("ADVISOR à 15 % sur une ligne : au-delà du plafond", () => {
    const r = checkDiscounts({
      role: "ADVISOR",
      caps: DEFAULT_DISCOUNT_CAPS,
      lineRates: [15, 0],
      globalRate: 0,
      hasOverride: false,
    });
    expect(r.withinCaps).toBe(false);
    expect(r.overLines).toEqual([0]);
    expect(r.cap.line).toBe(10);
    expect(r.reasonRequired).toBe(true);
  });
  it("remise globale au-delà de 5 % pour ADVISOR", () => {
    const r = checkDiscounts({
      role: "ADVISOR",
      caps: DEFAULT_DISCOUNT_CAPS,
      lineRates: [],
      globalRate: 6,
      hasOverride: false,
    });
    expect(r.overGlobal).toBe(true);
  });
  it("MANAGER dans son plafond ; override porte au plafond OWNER", () => {
    expect(
      checkDiscounts({
        role: "MANAGER",
        caps: DEFAULT_DISCOUNT_CAPS,
        lineRates: [20],
        globalRate: 15,
        hasOverride: false,
      }).withinCaps,
    ).toBe(true);
    expect(
      checkDiscounts({
        role: "ADVISOR",
        caps: DEFAULT_DISCOUNT_CAPS,
        lineRates: [60],
        globalRate: 0,
        hasOverride: true,
      }).withinCaps,
    ).toBe(true);
  });
  it("CASHIER : aucune remise ; motif non requis à 5 %", () => {
    expect(
      checkDiscounts({
        role: "CASHIER",
        caps: DEFAULT_DISCOUNT_CAPS,
        lineRates: [1],
        globalRate: 0,
        hasOverride: false,
      }).withinCaps,
    ).toBe(false);
    expect(
      checkDiscounts({
        role: "OWNER",
        caps: DEFAULT_DISCOUNT_CAPS,
        lineRates: [5],
        globalRate: 0,
        hasOverride: false,
      }).reasonRequired,
    ).toBe(false);
  });
  it("clampRates (« Approuver à 10 % »)", () => {
    expect(clampRates([15, 5, 0], 10)).toEqual([10, 5, 0]);
  });
});

describe("decisionResult (RG-M05-11)", () => {
  it("décision par groupe : urgent + balais acceptés, amortisseurs refusés → PARTIALLY_ACCEPTED", () => {
    const r = decisionResult(example, [
      { groupKey: "pads", accepted: true },
      { groupKey: "shocks", accepted: false, declineReason: "later" },
      { groupKey: "wipers", accepted: true },
    ]);
    expect(r.status).toBe("PARTIALLY_ACCEPTED");
    expect(r.acceptedLineIds).toEqual(["p-mo", "p-part", "w"]);
    expect(r.declineReasons.get("a-mo")).toBe("later");
  });
  it("optionnelles non touchées = refusées", () => {
    const r = decisionResult(example, [{ groupKey: "pads", accepted: true }]);
    expect(r.declinedLineIds).toEqual(["a-mo", "a-part", "w"]);
    expect(r.status).toBe("PARTIALLY_ACCEPTED");
  });
  it("tout accepté / tout refusé", () => {
    expect(
      decisionResult(
        example,
        ["pads", "shocks", "wipers"].map((g) => ({ groupKey: g, accepted: true })),
      ).status,
    ).toBe("ACCEPTED");
    expect(decisionResult(example, [{ groupKey: "pads", accepted: false }]).status).toBe(
      "DECLINED",
    );
  });
  it("non optionnelle non décidée → NON_OPTIONAL_UNDECIDED", () => {
    expect(() => decisionResult(example, [{ groupKey: "wipers", accepted: true }])).toThrow(
      /Plaquettes avant/,
    );
  });
  it("décision ligne par ligne prioritaire sur le groupe", () => {
    const r = decisionResult(example, [
      { groupKey: "pads", accepted: true },
      { lineId: "p-part", accepted: false },
    ]);
    expect(r.accepted.get("p-part")).toBe(false);
    expect(r.status).toBe("PARTIALLY_ACCEPTED");
  });
  it("lignes sans groupe : chaque ligne est son groupe", () => {
    const lines = [line({ id: "x", unitPrice: 1 }), line({ id: "y", unitPrice: 1 })];
    const r = decisionResult(lines, [
      { groupKey: "line:x", accepted: true },
      { groupKey: "line:y", accepted: false },
    ]);
    expect(r.status).toBe("PARTIALLY_ACCEPTED");
  });
  it("dépendance : disques sans plaquettes refusé", () => {
    const lines = [
      line({
        id: "pads",
        unitPrice: 1,
        groupKey: "pads",
        groupLabel: "Plaquettes avant",
        isOptional: true,
      }),
      line({
        id: "disc",
        unitPrice: 1,
        groupKey: "disc",
        requiresGroupKey: "pads",
        isOptional: true,
      }),
    ];
    expect(() =>
      decisionResult(lines, [
        { groupKey: "pads", accepted: false },
        { groupKey: "disc", accepted: true },
      ]),
    ).toThrow("Nécessite : Plaquettes avant.");
  });
  it("amendement : uniquement refusé → accepté", () => {
    const decided = example.map((l) => ({ ...l, accepted: l.groupKey === "pads" }));
    const r = amendDecision(decided, [{ groupKey: "wipers", accepted: true }]);
    expect(r.switchedLineIds).toEqual(["w"]);
    expect(r.status).toBe("PARTIALLY_ACCEPTED");
    expect(() => amendDecision(decided, [{ groupKey: "pads", accepted: false }])).toThrow();
    expect(() => amendDecision(decided, [{ groupKey: "pads", accepted: true }])).toThrow();
  });
});

describe("groupQuoteLines", () => {
  it("par priorité, total de groupe et décision commune", () => {
    const lines = [line({ id: "o", unitPrice: 10_000, sortOrder: 0 }), ...example];
    const totals = quoteTotals(lines);
    const groups = groupQuoteLines(lines, totals.lines);
    expect(groups.map((g) => g.key)).toEqual(["pads", "shocks", "wipers", "line:o"]);
    expect(groups[0]!.total).toBe(50_740);
    expect(groups[1]!.isOptional).toBe(true);
    expect(groups[0]!.accepted).toBeNull();
  });
});

describe("insurance (RG-M05-13)", () => {
  it("split et montant approuvé inférieur", () => {
    expect(
      insuranceSplit({ total: 1_180_000, insuranceLinesTotal: 1_180_000, deductible: 100_000 }),
    ).toEqual({
      insuranceShare: 1_080_000,
      customerShare: 100_000,
    });
    expect(
      insuranceSplit({ total: 50_000, insuranceLinesTotal: 50_000, deductible: 100_000 })
        .insuranceShare,
    ).toBe(0);
    expect(insuranceApprovalGap(1_080_000, 980_000)).toBe(100_000);
    expect(insuranceApprovalGap(1_080_000, 1_200_000)).toBe(0);
  });
});

describe("depositAmount (RG-M05-14)", () => {
  const rule = { thresholdTtc: 300_000, rate: 50 };
  it("850 000 → 425 000", () => {
    expect(depositAmount({ acceptedTotal: 850_000, rule })).toBe(425_000);
  });
  it("arrondi à la centaine supérieure, seuil", () => {
    expect(depositAmount({ acceptedTotal: 300_001, rule })).toBe(150_100);
    expect(depositAmount({ acceptedTotal: 299_999, rule })).toBe(0);
    expect(depositAmount({ acceptedTotal: 500_000, rule: null })).toBe(0);
  });
  it("pièces spéciales : au moins leur coût, même sous le seuil", () => {
    expect(depositAmount({ acceptedTotal: 120_000, rule, specialOrderCost: 45_250 })).toBe(45_300);
    expect(depositAmount({ acceptedTotal: 40_000, rule, specialOrderCost: 45_250 })).toBe(40_000);
  });
});

describe("quoteStats (RG-M05-16)", () => {
  function q(
    i: number,
    status: QuoteStatsInput["status"],
    total: number,
    acceptedTotal: number,
  ): QuoteStatsInput {
    return {
      number: `DEV-${i}`,
      version: 1,
      status,
      sentAt: new Date("2026-10-01T08:00:00Z"),
      decidedAt: status === "EXPIRED" ? null : new Date(`2026-10-0${1 + (i % 3)}T10:00:00Z`),
      total,
      acceptedTotal,
      advisorId: i % 2 ? "a1" : "a2",
    };
  }
  it("exemple : 40 clos, 26 acceptés → 65 % ; 4 850 000 / 3 120 000 → 64,33 %", () => {
    const list: QuoteStatsInput[] = [];
    for (let i = 0; i < 26; i++)
      list.push(q(i, i % 2 ? "ACCEPTED" : "PARTIALLY_ACCEPTED", 120_000, 120_000));
    for (let i = 26; i < 36; i++) list.push(q(i, "DECLINED", 130_000, 0));
    for (let i = 36; i < 40; i++) list.push(q(i, "EXPIRED", 107_500, 0));
    const s = quoteStats(list);
    expect(s.closed).toBe(40);
    expect(s.acceptedCount).toBe(26);
    expect(s.rateCount).toBe(65);
    expect(s.proposedAmount).toBe(4_850_000);
    expect(s.acceptedAmount).toBe(3_120_000);
    expect(s.rateValue).toBe(64.33);
  });
  it("dernière version seulement, non envoyés exclus, médiane", () => {
    const s = quoteStats([
      { ...q(1, "DECLINED", 100, 0), number: "A", version: 1 },
      { ...q(1, "ACCEPTED", 200, 200), number: "A", version: 2, hadFollowup: true },
      { ...q(2, "DRAFT", 300, 0), number: "B", sentAt: null },
    ]);
    expect(s.sent).toBe(1);
    expect(s.closed).toBe(1);
    expect(s.rateCount).toBe(100);
    expect(s.medianDecisionHours).toBe(26);
    expect(s.recoveredByFollowups).toBe(200);
  });
});

describe("lifecycle (§5)", () => {
  it("transitions et gardes", () => {
    expect(canQuoteTransition({ status: "DRAFT" }, "send").ok).toBe(true);
    expect(canQuoteTransition({ status: "ACCEPTED" }, "send").ok).toBe(false);
    expect(canQuoteTransition({ status: "SENT", supersededAt: new Date() }, "decide").ok).toBe(
      false,
    );
    expect(canQuoteTransition({ status: "DRAFT", sentAt: new Date() }, "delete").ok).toBe(false);
    expect(canQuoteTransition({ status: "EXPIRED" }, "edit").ok).toBe(true);
    expect(canQuoteTransition({ status: "DECLINED" }, "edit").ok).toBe(false);
  });
  it("sendBlockers (RG-M05-15)", () => {
    expect(sendBlockers({ lineCount: 0, total: 0, onlyNonBillable: false })).toHaveLength(1);
    expect(sendBlockers({ lineCount: 1, total: 0, onlyNonBillable: true })).toEqual([]);
    expect(
      sendBlockers({
        lineCount: 1,
        total: 10,
        onlyNonBillable: false,
        discountApprovalStatus: "PENDING",
      })[0],
    ).toMatch(/validation/);
  });
  it("validité (RG-M05-08) et expiration", () => {
    const today = new Date("2026-10-19T00:00:00Z");
    expect(defaultValidUntil(today, {}, DEFAULT_QUOTE_SETTINGS).toISOString().slice(0, 10)).toBe(
      "2026-11-03",
    );
    expect(
      defaultValidUntil(today, { customerType: "COMPANY" }, DEFAULT_QUOTE_SETTINGS)
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-11-18");
    const validUntil = new Date("2026-11-03T00:00:00Z");
    expect(shouldExpire({ status: "SENT", validUntil }, new Date("2026-11-03T00:00:00Z"))).toBe(
      false,
    );
    expect(shouldExpire({ status: "VIEWED", validUntil }, new Date("2026-11-04T00:00:00Z"))).toBe(
      true,
    );
    expect(
      shouldExpire({ status: "PARTIALLY_ACCEPTED", validUntil }, new Date("2026-11-04T00:00:00Z")),
    ).toBe(false);
    expect(portalLinkExpiry(validUntil).toISOString().slice(0, 10)).toBe("2026-12-04");
  });
  it("signature obligatoire au-delà d'1 000 000", () => {
    expect(signatureRequired(false, 999_999)).toBe(false);
    expect(signatureRequired(false, 1_000_000)).toBe(true);
  });
  it("isPreviewBot", () => {
    expect(isPreviewBot("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isPreviewBot("facebookexternalhit/1.1")).toBe(true);
    expect(isPreviewBot("Mozilla/5.0 (Linux; Android 10) Chrome/118 Mobile")).toBe(false);
    expect(isPreviewBot(null)).toBe(false);
  });
});

describe("settings", () => {
  it("défauts et surcharge partielle", () => {
    const s = quoteSettingsFrom({
      quotes: {
        validityDays: 10,
        discountCaps: { ADVISOR: { line: 12 } },
        depositRule: { thresholdTtc: 300_000, rate: 50 },
      },
    });
    expect(s.validityDays).toBe(10);
    expect(s.discountCaps.ADVISOR).toEqual({ line: 12, global: 5 });
    expect(s.depositRule).toEqual({ thresholdTtc: 300_000, rate: 50 });
    expect(quoteSettingsFrom(null)).toEqual(DEFAULT_QUOTE_SETTINGS);
  });
});

describe("contenu, versions, messages", () => {
  const base = {
    number: "DEV-YOP-2026-00017",
    version: 1,
    total: 100,
    lines: [
      {
        id: "b",
        description: "B",
        quantity: 1,
        unitPrice: 50,
        discountRate: 0,
        vatRate: 18,
        payer: "CUSTOMER" as const,
        lineTotal: 59,
      },
      {
        id: "a",
        description: "A",
        quantity: 1,
        unitPrice: 30,
        discountRate: 0,
        vatRate: 18,
        payer: "CUSTOMER" as const,
        lineTotal: 35,
      },
    ],
  };
  it("contenu canonique stable (ordre des lignes) et sensible aux prix", () => {
    const reversed = { ...base, lines: [...base.lines].reverse() };
    expect(canonicalQuoteContent(base)).toBe(canonicalQuoteContent(reversed));
    const changed = { ...base, lines: [{ ...base.lines[0]!, unitPrice: 51 }, base.lines[1]!] };
    expect(canonicalQuoteContent(changed)).not.toBe(canonicalQuoteContent(base));
    expect(canonicalQuoteContent({ ...base, version: 2 })).not.toBe(canonicalQuoteContent(base));
  });
  it("diffQuoteVersions", () => {
    const l = (description: string, unitPrice: number) => ({
      type: "PART",
      description,
      quantity: 1,
      unitPrice,
      discountRate: 0,
      lineTotal: unitPrice,
    });
    const d = diffQuoteVersions(
      { total: 300, lines: [l("A", 100), l("B", 200)] },
      { total: 330, lines: [l("A", 110), l("C", 220)] },
    );
    expect(d.added.map((x) => x.description)).toEqual(["C"]);
    expect(d.removed.map((x) => x.description)).toEqual(["B"]);
    expect(d.changed[0]!.fields).toEqual(["unitPrice"]);
    expect(d.totalDelta).toBe(30);
  });
  it("message d'envoi (US-M05-04)", () => {
    expect(
      quoteSendMessage({
        customerName: "M. Kouassi",
        number: "DEV-YOP-2026-00017",
        vehicle: "Toyota Corolla",
        plate: "2547 GH 01",
        total: 201_780,
        urgentTotal: 50_740,
        link: "https://x/p/t",
        garageName: "Garage Excellence Auto",
      }),
    ).toBe(
      "Bonjour M. Kouassi, voici le devis DEV-YOP-2026-00017 pour votre Toyota Corolla (2547 GH 01) : 201 780 FCFA TTC (dont 50 740 FCFA urgents). Consultez-le et validez les travaux ici : https://x/p/t — Garage Excellence Auto",
    );
  });
  it("confirmation téléphonique (US-M05-07)", () => {
    expect(
      phoneConfirmationMessage({
        time: "10:15",
        accepted: [{ label: "Plaquettes avant", total: 50_740 }],
        declined: ["Amortisseurs arrière", "Balais"],
      }),
    ).toBe(
      "Suite à notre appel de 10:15, vous avez accepté : Plaquettes avant (50 740 FCFA TTC). Refusé : Amortisseurs arrière, Balais. Si ce n'est pas correct, répondez à ce message.",
    );
  });
  it("durées par véhicule (RG-M05-05)", () => {
    const overrides = [
      { make: "Toyota", model: "Hilux", standardHours: 4.5 },
      { make: "Toyota", standardHours: 3.5 },
    ];
    expect(laborHoursForVehicle(3, overrides, { make: "toyota", model: "Hilux" })).toBe(4.5);
    expect(laborHoursForVehicle(3, overrides, { make: "Toyota", model: "Corolla" })).toBe(3.5);
    expect(laborHoursForVehicle(3, overrides, { make: "Hyundai" })).toBe(3);
    expect(laborHoursForVehicle(3, overrides, null)).toBe(3);
  });
});
