import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock";
import { resolveCustomPeriod, resolvePeriod, daysOf } from "../dashboard/period";
import { agedBalanceAt } from "./aging";
import { formatCell, reportFileName, reportTotals, REPORTS, visibleColumns } from "./catalog";
import { classifyCustomer, customerCounts, normalizeDescription, rankTopParts } from "./customers";
import { shiftMonths } from "./dates";
import { capacityMinutes, collectedByMethod, occupancy, quoteAcceptance } from "./operations";
import {
  averageTicket,
  computeMargins,
  computeRevenue,
  laborCostOf,
  natureOf,
  signedAmount,
} from "./revenue";
import { compareSites, type SiteFacts } from "./sites";

const TZ = "Africa/Abidjan";
const clock = fixedClock(new Date("2026-10-18T10:00:00.000Z"));
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

describe("périodes étendues (RG-M12-01, US-M12-02)", () => {
  it("trimestre en cours du 01/10 au 18/10 → même durée au trimestre précédent", () => {
    const p = resolvePeriod("quarter", clock.now(), TZ);
    expect([p.fromDate, p.toDate]).toEqual(["2026-10-01", "2026-10-19"]);
    expect([p.previousFromDate, p.previousToDate]).toEqual(["2026-07-01", "2026-07-19"]);
  });

  it("trimestre : le 15/05 commence au 01/04", () => {
    const p = resolvePeriod("quarter", new Date("2026-05-15T12:00:00Z"), TZ);
    expect(p.fromDate).toBe("2026-04-01");
    expect(p.previousFromDate).toBe("2026-01-01");
  });

  it("année en cours → même durée de l'année précédente", () => {
    const p = resolvePeriod("year", clock.now(), TZ);
    expect([p.fromDate, p.toDate]).toEqual(["2026-01-01", "2026-10-19"]);
    expect([p.previousFromDate, p.previousToDate]).toEqual(["2025-01-01", "2025-10-19"]);
  });

  it("personnalisée : bornes incluses, comparaison de même durée, ordre corrigé", () => {
    const p = resolveCustomPeriod("2026-09-01", "2026-09-30", TZ);
    expect([p.fromDate, p.toDate]).toEqual(["2026-09-01", "2026-10-01"]);
    expect([p.previousFromDate, p.previousToDate]).toEqual(["2026-08-02", "2026-09-01"]);
    expect(resolveCustomPeriod("2026-09-30", "2026-09-01", TZ).fromDate).toBe("2026-09-01");
    expect(p.preset).toBe("custom");
  });

  it("facture du 31/10 à 23 h 30 (Abidjan) comptée en octobre : borne = minuit local", () => {
    const p = resolveCustomPeriod("2026-10-01", "2026-10-31", TZ);
    const issuedAt = new Date("2026-10-31T23:30:00.000Z");
    expect(issuedAt.getTime()).toBeLessThan(p.to.getTime());
    // Fuseau UTC+1 (ex. Lagos) : 23 h 30 UTC = 00 h 30 le 01/11 → hors octobre.
    const lagos = resolveCustomPeriod("2026-10-01", "2026-10-31", "Africa/Lagos");
    expect(issuedAt.getTime()).toBeGreaterThanOrEqual(lagos.to.getTime());
  });

  it("daysOf liste les jours de [from, to)", () => {
    expect(daysOf("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});

describe("CA et marges (RG-M12-03 à 11)", () => {
  it("§12 : 3 factures 100 000 / 250 000 / 85 000 HT + avoir 35 000 → CA 400 000", () => {
    const r = computeRevenue([
      { invoiceType: "INVOICE", lineType: "LABOR", subtotal: 100_000, total: 118_000, cost: 0 },
      {
        invoiceType: "INVOICE",
        lineType: "PART",
        subtotal: 250_000,
        total: 295_000,
        cost: 150_000,
      },
      { invoiceType: "INVOICE", lineType: "FEE", subtotal: 85_000, total: 100_300, cost: 0 },
      // M08 : avoir à montants négatifs.
      {
        invoiceType: "CREDIT_NOTE",
        lineType: "PART",
        subtotal: -35_000,
        total: -41_300,
        cost: -21_000,
      },
    ]);
    expect(r.ht).toBe(400_000);
    expect(r.ttc).toBe(472_000);
    expect(r.byNature).toEqual({ labor: 100_000, parts: 215_000, subcontract: 0, fees: 85_000 });
    expect(r.partsCost).toBe(129_000);
  });

  it("avoir positif (convention PRD) : soustrait de la même façon", () => {
    expect(signedAmount("CREDIT_NOTE", 35_000)).toBe(-35_000);
    expect(signedAmount("CREDIT_NOTE", -35_000)).toBe(-35_000);
    expect(signedAmount("INVOICE", 35_000)).toBe(35_000);
  });

  it("acomptes hors CA ; facture importée sans lignes comptée en frais", () => {
    const r = computeRevenue([
      { invoiceType: "DEPOSIT", lineType: "FEE", subtotal: 50_000, total: 59_000, cost: 0 },
      { invoiceType: "INVOICE", lineType: null, subtotal: 120_000, total: 141_600, cost: 0 },
    ]);
    expect(r.ht).toBe(120_000);
    expect(r.byNature.fees).toBe(120_000);
  });

  it("CA par nature : consommables avec les pièces, sous-traitance à part", () => {
    expect(natureOf("CONSUMABLE")).toBe("parts");
    expect(natureOf("SUBCONTRACT")).toBe("subcontract");
    expect(natureOf("FEE")).toBe("fees");
  });

  it("coût MO : heures × coût horaire, défaut 2 500 FCFA/h et « coût estimé »", () => {
    expect(laborCostOf([{ minutes: 120, hourlyCost: 3_000 }])).toEqual({
      cost: 6_000,
      estimated: false,
    });
    expect(laborCostOf([{ minutes: 90, hourlyCost: null }])).toEqual({
      cost: 3_750,
      estimated: true,
    });
    expect(laborCostOf([{ minutes: 60, hourlyCost: 0 }], 4_000).cost).toBe(4_000);
  });

  it("marge globale = pièces + MO + frais + sous-traitance ; taux / CA HT", () => {
    const revenue = computeRevenue([
      { invoiceType: "INVOICE", lineType: "LABOR", subtotal: 100_000, total: 118_000, cost: 0 },
      {
        invoiceType: "INVOICE",
        lineType: "PART",
        subtotal: 200_000,
        total: 236_000,
        cost: 120_000,
        uncostedLines: 1,
      },
      { invoiceType: "INVOICE", lineType: "SUBCONTRACT", subtotal: 50_000, total: 59_000, cost: 0 },
    ]);
    const m = computeMargins(revenue, { cost: 30_000, estimated: false });
    expect(m.partsMargin).toBe(80_000);
    expect(m.partsRate).toBeCloseTo(0.4);
    expect(m.laborMargin).toBe(70_000);
    expect(m.grossMargin).toBe(200_000);
    expect(m.grossRate).toBeCloseTo(200_000 / 350_000);
    expect(m.subcontractUncosted).toBe(true);
    expect(m.estimated).toEqual({ parts: true, labor: false });
  });

  it("CA nul : taux « — » (null)", () => {
    const m = computeMargins(computeRevenue([]), { cost: 0, estimated: false });
    expect(m.grossRate).toBeNull();
    expect(m.partsRate).toBeNull();
  });

  it("panier moyen : CA HT / nombre de factures, arrondi ; aucune facture → null", () => {
    expect(averageTicket(400_000, 3)).toBe(133_333);
    expect(averageTicket(0, 0)).toBeNull();
  });
});

describe("devis, occupation, encaissements (RG-M12-13/14/20)", () => {
  it("taux d'acceptation en nombre et en valeur", () => {
    const a = quoteAcceptance([
      { status: "ACCEPTED", count: 3, total: 300_000, acceptedTotal: 300_000 },
      { status: "PARTIALLY_ACCEPTED", count: 1, total: 200_000, acceptedTotal: 50_000 },
      { status: "DECLINED", count: 1, total: 100_000, acceptedTotal: 0 },
      { status: "EXPIRED", count: 1, total: 400_000, acceptedTotal: 0 },
      { status: "SENT", count: 10, total: 999_999, acceptedTotal: 0 },
    ]);
    expect(a.decided).toBe(6);
    expect(a.accepted).toBe(4);
    expect(a.countRate).toBeCloseTo(4 / 6);
    expect(a.valueRate).toBeCloseTo(350_000 / 1_000_000);
    expect(quoteAcceptance([]).countRate).toBeNull();
  });

  it("capacité : ponts actifs × heures d'ouverture, jours fériés exclus", () => {
    const openingHours = {
      mon: [
        ["08:00", "12:00"],
        ["14:00", "18:00"],
      ] as [string, string][],
      tue: [["08:00", "18:00"]] as [string, string][],
    };
    // 19/10/2026 lundi, 20/10 mardi, 21/10 mercredi (fermé).
    const days = ["2026-10-19", "2026-10-20", "2026-10-21"];
    expect(capacityMinutes({ days, timeZone: TZ, openingHours, siteId: "s1", activeBays: 2 })).toBe(
      (8 * 60 + 10 * 60) * 2,
    );
    expect(
      capacityMinutes({
        days,
        timeZone: TZ,
        openingHours,
        siteId: "s1",
        activeBays: 2,
        holidays: [{ date: day("2026-10-20"), siteId: null }],
      }),
    ).toBe(8 * 60 * 2);
    expect(
      capacityMinutes({ days, timeZone: TZ, openingHours: {}, siteId: "s1", activeBays: 2 }),
    ).toBeNull();
  });

  it("occupation : brute à l'export, plafonnée à 100 % à l'affichage", () => {
    const o = occupancy(1_200, 600, 1_000);
    expect(o.real).toBeCloseTo(1.2);
    expect(o.capped.real).toBe(1);
    expect(o.planned).toBeCloseTo(0.6);
    expect(occupancy(10, 10, null).real).toBeNull();
  });

  it("encaissements par mode, remboursements en négatif", () => {
    const c = collectedByMethod(
      [
        { method: "WAVE", amount: 520_000 },
        { method: "CASH", amount: 310_000 },
        { method: "ORANGE_MONEY", amount: 150_000 },
      ],
      [{ method: "CASH", amount: 10_000 }],
    );
    expect(c.total).toBe(970_000);
    expect(c.byMethod).toEqual({ WAVE: 520_000, CASH: 300_000, ORANGE_MONEY: 150_000 });
  });
});

describe("balance âgée à une date (RG-M12-18)", () => {
  const asOf = day("2026-09-30");
  const invoice = (
    id: string,
    dueDate: string,
    extra: Partial<Parameters<typeof agedBalanceAt>[0][number]> = {},
  ) => ({
    id,
    number: `FAC-${id}`,
    customerId: "c1",
    customerName: "SOTRA Logistique",
    issuedAt: day("2026-06-01"),
    dueDate: day(dueDate),
    total: 100_000,
    paidAtDate: 0,
    creditedAtDate: 0,
    ...extra,
  });

  it("tranches aux bornes 0, 30, 31, 90, 91 jours", () => {
    const b = agedBalanceAt(
      [
        invoice("a", "2026-09-30"), // 0 j → non échu
        invoice("b", "2026-08-31"), // 30 j
        invoice("c", "2026-08-30"), // 31 j
        invoice("d", "2026-07-02"), // 90 j
        invoice("e", "2026-07-01"), // 91 j
      ],
      asOf,
    );
    expect(Object.fromEntries(b.rows.map((r) => [r.id, [r.daysLate, r.bucket]]))).toEqual({
      a: [0, "notDue"],
      b: [30, "b0_30"],
      c: [31, "b31_60"],
      d: [90, "b61_90"],
      e: [91, "b90p"],
    });
    expect(b.total).toBe(500_000);
  });

  it("solde reconstitué : paiements et avoirs ≤ T déduits, soldées et pertes exclues", () => {
    const b = agedBalanceAt(
      [
        invoice("p", "2026-09-01", { paidAtDate: 60_000, creditedAtDate: 10_000 }),
        invoice("q", "2026-09-01", { paidAtDate: 100_000 }),
        invoice("r", "2026-09-01", { writtenOffAtDate: true }),
      ],
      asOf,
    );
    expect(b.rows.map((r) => [r.id, r.balance, r.paid])).toEqual([["p", 30_000, 70_000]]);
    expect(b.byCustomer).toEqual([
      {
        customerId: "c1",
        customerName: "SOTRA Logistique",
        total: 30_000,
        buckets: { notDue: 0, b0_30: 30_000, b31_60: 0, b61_90: 0, b90p: 0 },
      },
    ]);
  });
});

describe("clients et top pièces (RG-M12-25/26)", () => {
  const end = day("2026-11-01");
  it("actif < 12 mois, perdu entre 24 et 12 mois, nouveau dans la période", () => {
    expect(classifyCustomer({ lastAt: day("2026-03-01") }, end)).toBe("active");
    expect(classifyCustomer({ lastAt: day("2025-06-01") }, end)).toBe("lost");
    expect(classifyCustomer({ lastAt: day("2023-01-01") }, end)).toBe("inactive");
    const counts = customerCounts(
      [
        { customerId: "a", firstAt: day("2026-10-05"), lastAt: day("2026-10-05") },
        { customerId: "b", firstAt: day("2024-01-01"), lastAt: day("2026-02-01") },
        { customerId: "c", firstAt: day("2023-01-01"), lastAt: day("2025-01-15") },
      ],
      day("2026-10-01"),
      end,
    );
    expect(counts).toEqual({ active: 2, new: 1, lost: 1 });
  });

  it("shiftMonths borne au dernier jour du mois", () => {
    expect(shiftMonths(day("2026-03-31"), -1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("top pièces : tri par CA HT puis quantité, marge = HT − coût", () => {
    const top = rankTopParts(
      [
        {
          key: "p1",
          productId: "p1",
          label: "Filtre à huile",
          quantity: 40,
          ht: 200_000,
          cost: 120_000,
          repairOrders: 30,
        },
        {
          key: "p2",
          productId: "p2",
          label: "Plaquettes",
          quantity: 10,
          ht: 250_000,
          cost: 150_000,
          repairOrders: 8,
        },
        {
          key: "huile",
          productId: null,
          label: "Huile 5W30",
          quantity: 50,
          ht: 200_000,
          cost: 100_000,
          repairOrders: 20,
        },
      ],
      2,
    );
    expect(top.map((t) => t.key)).toEqual(["p2", "huile"]);
    expect(top[1]!.margin).toBe(100_000);
    expect(normalizeDescription("  Filtre  À HUILE ")).toBe("filtre a huile");
  });
});

describe("comparaison des sites (US-M12-07)", () => {
  const base: Omit<SiteFacts, "siteId" | "name"> = {
    revenueHt: 0,
    grossMargin: 0,
    invoiceCount: 0,
    repairOrders: 0,
    quotesAccepted: 0,
    quotesDecided: 0,
    workedMinutes: 0,
    capacityMinutes: null,
    soldHours: 0,
    workedHoursOnSold: 0,
    receivables: 0,
    revenueTtc90d: 0,
  };
  it("ligne Réseau recalculée depuis les sommes, classement par indicateur", () => {
    const c = compareSites([
      {
        ...base,
        siteId: "yop",
        name: "Yopougon",
        revenueHt: 3_000_000,
        grossMargin: 900_000,
        invoiceCount: 30,
        receivables: 1_000_000,
        revenueTtc90d: 9_000_000,
        workedMinutes: 600,
        capacityMinutes: 1_000,
      },
      {
        ...base,
        siteId: "coc",
        name: "Cocody",
        revenueHt: 1_000_000,
        grossMargin: 500_000,
        invoiceCount: 5,
        receivables: 200_000,
        revenueTtc90d: 1_000_000,
        capacityMinutes: null,
      },
    ]);
    expect(c.network.revenueHt).toBe(4_000_000);
    expect(c.network.grossRate).toBeCloseTo(1_400_000 / 4_000_000);
    expect(c.network.avgTicket).toBe(Math.round(4_000_000 / 35));
    expect(c.network.occupancy).toBeCloseTo(0.6);
    expect(c.best.revenueHt).toBe("yop");
    expect(c.best.grossRate).toBe("coc");
    // L'encours et le DSO : plus bas = meilleur.
    expect(c.best.receivables).toBe("coc");
    expect(c.ranks.yop!.dso).toBe(1); // 10 j contre 18 j
    expect(c.ranks.coc!.dso).toBe(2);
    expect(c.sites[1]!.values.occupancy).toBeNull();
    expect(c.best.acceptanceRate).toBeNull();
  });
});

describe("catalogue des rapports (M12 §7)", () => {
  it("nom de fichier {slug}_{from}_{to}_{site|reseau}", () => {
    expect(
      reportFileName({ slug: "ventes", from: "2026-10-01", to: "2026-10-31", format: "xlsx" }),
    ).toBe("ventes_2026-10-01_2026-10-31_reseau.xlsx");
    expect(
      reportFileName({
        slug: "balance-agee",
        asOf: "2026-09-30",
        site: "Atelier Yopougon",
        format: "pdf",
      }),
    ).toBe("balance-agee_2026-09-30_Atelier-Yopougon.pdf");
  });

  it("marges omises sans report:financial ; 9 rapports", () => {
    expect(Object.keys(REPORTS)).toHaveLength(9);
    expect(visibleColumns("top-pieces", false).map((c) => c.key)).not.toContain("margin");
    expect(visibleColumns("top-pieces", true).map((c) => c.key)).toContain("margin");
  });

  it("totaux et format d'affichage", () => {
    const columns = REPORTS["top-pieces"].columns;
    expect(
      reportTotals(columns, [
        { label: "A", quantity: 2, ht: 1_000, margin: 400, repairOrders: 1 },
        { label: "B", quantity: 3, ht: 2_500, margin: null, repairOrders: 2 },
      ]),
    ).toEqual({ quantity: 5, ht: 3_500, margin: 400 });
    expect(formatCell("money", 185_000)).toBe("185 000 FCFA");
    expect(formatCell("money", -12_500)).toBe("-12 500 FCFA");
    expect(formatCell("date", "2026-09-30")).toBe("30/09/2026");
    expect(formatCell("percent", 0.4567)).toBe("45,7 %");
    expect(formatCell("hours", 1.5)).toBe("1,50 h");
    expect(formatCell("number", null)).toBe("");
  });
});
