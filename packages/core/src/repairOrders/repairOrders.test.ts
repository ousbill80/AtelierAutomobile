import { describe, expect, it } from "vitest";
import {
  availableTransitions,
  canDeliver,
  canTransition,
  categoryResults,
  checkInIssues,
  complaintCategories,
  decideLineApproval,
  evaluateQc,
  isLate,
  isProbableComeback,
  isUnderWarranty,
  laborLinePricing,
  laborRatesFrom,
  lineAmounts,
  repairOrderSettingsFrom,
  repairOrderTotals,
  roundLaborHours,
  statusAfterInspection,
  storageFee,
  suggestPromisedAt,
  summarizeInspection,
  timelineIndex,
  warrantyFor,
  worstResult,
  type CanDeliverInput,
  type RepairOrderLineLike,
  type TransitionContext,
  type TransitionLine,
} from "./index";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function line(partial: Partial<RepairOrderLineLike>): RepairOrderLineLike {
  return {
    type: "LABOR",
    quantity: 1,
    unitPrice: 0,
    discountRate: 0,
    vatRate: 18,
    status: "PENDING",
    approval: "APPROVED",
    payer: "CUSTOMER",
    ...partial,
  };
}

describe("lineAmounts / repairOrderTotals (RG-M04-05)", () => {
  it("exemple RG : 2,5 h × 15 000, remise 10 %, TVA 18 % → 39 825 TTC", () => {
    expect(lineAmounts(line({ quantity: 2.5, unitPrice: 15_000, discountRate: 10 }))).toEqual({
      gross: 37_500,
      subtotal: 33_750,
      vat: 6_075,
      total: 39_825,
    });
  });

  it("US-M04-09 : vidange + huile + filtre → 31 000 HT, 5 580 TVA, 36 580 TTC", () => {
    const totals = repairOrderTotals([
      line({ quantity: 0.5, unitPrice: 15_000 }),
      line({ type: "PART", quantity: 4, unitPrice: 4_500 }),
      line({ type: "PART", quantity: 1, unitPrice: 5_500 }),
    ]);
    expect(totals.subtotal).toBe(31_000);
    expect(totals.vatTotal).toBe(5_580);
    expect(totals.total).toBe(36_580);
    expect(totals.totalEstimate).toBe(36_580);
  });

  it("arrondit la TVA par ligne (demi-supérieur)", () => {
    // 3 × 1 001 HT = 3 003 ; TVA 18 % = 540,54 → 541
    expect(lineAmounts(line({ quantity: 3, unitPrice: 1_001 })).vat).toBe(541);
  });

  it("TVA désactivée → 0", () => {
    expect(lineAmounts(line({ quantity: 1, unitPrice: 10_000 }), false)).toMatchObject({
      vat: 0,
      total: 10_000,
    });
  });

  it("pièce fournie par le client → 0 FCFA", () => {
    expect(
      lineAmounts(line({ type: "PART", unitPrice: 18_000, isCustomerSupplied: true })).total,
    ).toBe(0);
  });

  it("exclut lignes annulées, refusées et garantie ; sépare l'attente d'accord", () => {
    const totals = repairOrderTotals([
      line({ unitPrice: 10_000 }),
      line({ unitPrice: 10_000, status: "CANCELLED" }),
      line({ unitPrice: 10_000, approval: "DECLINED" }),
      line({ unitPrice: 10_000, payer: "WARRANTY", approval: "NOT_REQUIRED" }),
      line({ unitPrice: 5_000, approval: "PENDING" }),
    ]);
    expect(totals.totalEstimate).toBe(11_800);
    expect(totals.pendingTotal).toBe(5_900);
    expect(totals.total).toBe(17_700);
  });
});

describe("laborLinePricing / laborRatesFrom (RG-M04-06, A3)", () => {
  it("taux horaire selon rateType", () => {
    expect(laborLinePricing({ standardHours: 0.5, rateType: "STANDARD" })).toEqual({
      quantity: 0.5,
      unitPrice: 15_000,
    });
    expect(laborLinePricing({ standardHours: 1, rateType: "ELECTRICAL" }).unitPrice).toBe(18_000);
  });
  it("forfait → 1 × fixedPrice", () => {
    expect(
      laborLinePricing({ standardHours: 1, rateType: "STANDARD", fixedPrice: 25_000 }),
    ).toEqual({ quantity: 1, unitPrice: 25_000 });
  });
  it("lit settings.labor.rates puis settings.laborRates", () => {
    expect(laborRatesFrom({ labor: { rates: { STANDARD: 12_000 } } }).STANDARD).toBe(12_000);
    expect(laborRatesFrom({ laborRates: { DIAGNOSTIC: 25_000 } }).DIAGNOSTIC).toBe(25_000);
    expect(laborRatesFrom(null).BODYWORK).toBe(15_000);
  });
  it("arrondit la MO au quart d'heure", () => {
    expect(roundLaborHours(1.1)).toBe(1);
    expect(roundLaborHours(1.13)).toBe(1.25);
  });
});

describe("decideLineApproval (US-M04-05, RG-M04-08)", () => {
  const base = { payer: "CUSTOMER" as const, authorizationCeiling: 50_000, preAuthorizedTotal: 0 };
  it("cumul 48 000 ≤ 50 000 → APPROVED pré-autorisé", () => {
    expect(decideLineApproval({ ...base, phase: "AFTER_CHECK_IN", lineTotal: 48_000 })).toEqual({
      approval: "APPROVED",
      approvalSource: "PRE_AUTHORIZED",
    });
  });
  it("+ 5 000 → PENDING", () => {
    expect(
      decideLineApproval({
        ...base,
        phase: "AFTER_CHECK_IN",
        preAuthorizedTotal: 48_000,
        lineTotal: 5_000,
      }).approval,
    ).toBe("PENDING");
  });
  it("plafond 0 → PENDING ; réception → APPROVED ; garantie → NOT_REQUIRED", () => {
    expect(
      decideLineApproval({
        ...base,
        authorizationCeiling: 0,
        phase: "AFTER_CHECK_IN",
        lineTotal: 1,
      }).approval,
    ).toBe("PENDING");
    expect(decideLineApproval({ ...base, phase: "CHECK_IN", lineTotal: 999_999 })).toEqual({
      approval: "APPROVED",
      approvalSource: "CHECK_IN",
    });
    expect(
      decideLineApproval({ ...base, payer: "WARRANTY", phase: "AFTER_CHECK_IN", lineTotal: 1 })
        .approval,
    ).toBe("NOT_REQUIRED");
  });
});

describe("warrantyFor / isUnderWarranty (RG-M04-11)", () => {
  const delivered = d("2026-10-20");
  it("MO : 3 mois ou 5 000 km", () => {
    const w = warrantyFor({ type: "LABOR", isCustomerSupplied: false }, delivered, 48_200);
    expect(w).toEqual({
      warrantyMonths: 3,
      warrantyKm: 5_000,
      warrantyUntilDate: d("2027-01-20"),
      warrantyUntilMileage: 53_200,
    });
  });
  it("pièce garage 6 mois / 10 000 km ; pièce client : aucune ; montage pièce client : 1 mois", () => {
    expect(
      warrantyFor({ type: "PART", isCustomerSupplied: false }, delivered, 48_200)
        .warrantyUntilMileage,
    ).toBe(58_200);
    expect(
      warrantyFor({ type: "PART", isCustomerSupplied: true }, delivered, 48_200).warrantyMonths,
    ).toBeNull();
    const montage = warrantyFor({ type: "LABOR", isCustomerSupplied: true }, delivered, 48_200);
    expect(montage.warrantyUntilDate).toEqual(d("2026-11-20"));
    expect(montage.warrantyUntilMileage).toBeNull();
  });
  it("sous-traitance : valeurs saisies ; frais : aucune", () => {
    expect(
      warrantyFor(
        { type: "SUBCONTRACT", isCustomerSupplied: false, warrantyMonths: 12 },
        delivered,
        null,
      ).warrantyUntilDate,
    ).toEqual(d("2027-10-20"));
    expect(
      warrantyFor({ type: "FEE", isCustomerSupplied: false }, delivered, 1).warrantyMonths,
    ).toBeNull();
  });
  it("fin de mois bornée (31/01 + 1 mois = 28/02)", () => {
    expect(
      warrantyFor({ type: "LABOR", isCustomerSupplied: true }, d("2027-01-31"), null)
        .warrantyUntilDate,
    ).toEqual(d("2027-02-28"));
  });
  it("premier atteint : date ou kilométrage", () => {
    const w = { warrantyUntilDate: d("2027-01-20"), warrantyUntilMileage: 53_200 };
    expect(isUnderWarranty(w, d("2026-11-01"), 50_000)).toBe(true);
    expect(isUnderWarranty(w, d("2026-11-01"), 53_201)).toBe(false);
    expect(isUnderWarranty(w, d("2027-01-21"), 49_000)).toBe(false);
    expect(isUnderWarranty(w, d("2027-01-20"), null)).toBe(true);
    expect(
      isUnderWarranty({ warrantyUntilDate: null, warrantyUntilMileage: null }, d("2026-11-01"), 1),
    ).toBe(false);
  });
});

describe("isProbableComeback (RG-M04-12)", () => {
  const base = {
    previousDeliveredAt: d("2026-10-09"),
    previousMileage: 48_200,
    previousCategories: complaintCategories("Bruit au freinage à l'avant + vidange"),
    now: d("2026-10-19"),
    mileage: 48_700,
    categories: complaintCategories("Toujours un bruit de frein"),
  };
  it("10 jours, 500 km, freinage commun → retour probable", () => {
    expect(base.previousCategories).toEqual(["Freinage", "Entretien"]);
    expect(isProbableComeback(base)).toBe(true);
  });
  it("au-delà de 30 jours, de 1 000 km ou sans catégorie commune → non", () => {
    expect(isProbableComeback({ ...base, now: d("2026-11-09") })).toBe(false);
    expect(isProbableComeback({ ...base, mileage: 49_300 })).toBe(false);
    expect(isProbableComeback({ ...base, categories: ["Climatisation"] })).toBe(false);
  });
  it("kilométrage inconnu : seule la durée compte", () => {
    expect(isProbableComeback({ ...base, mileage: null })).toBe(true);
  });
});

describe("canDeliver (RG-M04-14)", () => {
  const base: CanDeliverInput = {
    customerBalance: 36_580,
    invoiceIssued: true,
    paymentTermsDays: 0,
    creditLimit: null,
    outstanding: 0,
    cashOnly: false,
    creditHold: false,
    canForceUnpaid: false,
  };
  it("1. facture soldée → PAID", () => {
    expect(canDeliver({ ...base, customerBalance: 0 })).toEqual({ ok: true, basis: "PAID" });
  });
  it("client comptant avec solde → UNPAID_BALANCE", () => {
    const r = canDeliver(base);
    expect(r).toMatchObject({ ok: false, code: "UNPAID_BALANCE", balance: 36_580 });
    if (!r.ok)
      expect(r.message).toBe(
        "Solde à régler : 36 580 FCFA. Encaissez ou demandez l'autorisation du gérant.",
      );
  });
  it("2. client à 30 jours sous plafond → CREDIT ; au-dessus → CREDIT_LIMIT_EXCEEDED", () => {
    expect(
      canDeliver({ ...base, paymentTermsDays: 30, creditLimit: 1_000_000, outstanding: 500_000 }),
    ).toEqual({ ok: true, basis: "CREDIT" });
    expect(canDeliver({ ...base, paymentTermsDays: 30, creditLimit: null })).toEqual({
      ok: true,
      basis: "CREDIT",
    });
    expect(
      canDeliver({ ...base, paymentTermsDays: 30, creditLimit: 500_000, outstanding: 480_000 }),
    ).toMatchObject({
      ok: false,
      code: "CREDIT_LIMIT_EXCEEDED",
      outstanding: 516_580,
      limit: 500_000,
    });
  });
  it("crédit refusé si OR cashOnly ou client bloqué", () => {
    expect(canDeliver({ ...base, paymentTermsDays: 30, cashOnly: true }).ok).toBe(false);
    expect(canDeliver({ ...base, paymentTermsDays: 30, creditHold: true }).ok).toBe(false);
  });
  it("3. assurance réglée → INSURANCE", () => {
    expect(canDeliver({ ...base, insuranceSettled: true })).toEqual({
      ok: true,
      basis: "INSURANCE",
    });
  });
  it("4. forçage : permission ET motif", () => {
    expect(
      canDeliver({ ...base, canForceUnpaid: true, forceUnpaidReason: "Client fidèle" }),
    ).toEqual({
      ok: true,
      basis: "FORCED",
    });
    expect(canDeliver({ ...base, canForceUnpaid: true, forceUnpaidReason: "  " }).ok).toBe(false);
    expect(canDeliver({ ...base, canForceUnpaid: false, forceUnpaidReason: "x" }).ok).toBe(false);
  });
});

describe("storageFee (RG-M04-15)", () => {
  it("exemple PRD : du 30/10 au 05/11, 6 j × 2 000 = 12 000 (dimanche exclu)", () => {
    const fee = storageFee({
      readyOn: d("2026-10-21"),
      today: d("2026-11-05"),
      afterDays: 7,
      perDay: 2_000,
    });
    expect(fee).toMatchObject({ from: d("2026-10-30"), days: 6, amount: 12_000 });
    expect(fee?.description).toBe("Frais de gardiennage du 30/10 au 05/11 (6 j × 2 000 FCFA)");
  });
  it("rien pendant la période de grâce", () => {
    expect(
      storageFee({ readyOn: d("2026-10-21"), today: d("2026-10-29"), afterDays: 7, perDay: 2_000 }),
    ).toBeNull();
  });
  it("jours fériés exclus", () => {
    const fee = storageFee({
      readyOn: d("2026-10-21"),
      today: d("2026-11-05"),
      afterDays: 7,
      perDay: 2_000,
      holidays: [d("2026-11-02")],
    });
    expect(fee?.days).toBe(5);
  });
});

describe("checkInIssues (RG-M04-03, CheckInSchema)", () => {
  const ok = {
    mileageIn: 48_200,
    odometerUnreadable: false,
    fuelLevel: 3,
    photoCount: 4,
    minPhotos: 4,
    noDamage: false,
    damageCount: 1,
    complaint: "Bruit au freinage",
    signature: "SIGNED" as const,
  };
  it("réception complète → aucune anomalie", () => {
    expect(checkInIssues(ok)).toEqual([]);
  });
  it("liste vide de dommages sans « Aucun dommage » → refus", () => {
    expect(checkInIssues({ ...ok, damageCount: 0 }).map((i) => i.field)).toEqual(["damages"]);
    expect(checkInIssues({ ...ok, damageCount: 0, noDamage: true })).toEqual([]);
    expect(checkInIssues({ ...ok, noDamage: true }).map((i) => i.field)).toEqual(["damages"]);
  });
  it("compteur illisible : motif obligatoire, pas de km", () => {
    expect(
      checkInIssues({ ...ok, mileageIn: null, odometerUnreadable: true }).map((i) => i.field),
    ).toEqual(["mileageIn"]);
    expect(
      checkInIssues({
        ...ok,
        mileageIn: null,
        odometerUnreadable: true,
        odometerReason: "Tableau éteint",
      }),
    ).toEqual([]);
  });
  it("photos minimales paramétrables, carburant 0-8, doléances, signature", () => {
    const issues = checkInIssues({
      ...ok,
      mileageIn: null,
      photoCount: 2,
      fuelLevel: 9,
      complaint: " ",
      signature: null,
    });
    expect(issues.map((i) => i.field)).toEqual([
      "mileageIn",
      "fuelLevel",
      "photos",
      "complaint",
      "signature",
    ]);
    expect(checkInIssues({ ...ok, photoCount: 0, minPhotos: 0 })).toEqual([]);
    expect(checkInIssues({ ...ok, signature: "REMOTE" })).toEqual([]);
    expect(checkInIssues({ ...ok, signature: "REFUSED" })).toEqual([]);
  });
});

describe("inspection (RG-M04-16/17, US-M04-06)", () => {
  const items = [
    {
      category: "Freinage",
      result: "URGENT" as const,
      recommendedProductIds: ["p"],
      recommendedLaborIds: ["l"],
    },
    {
      category: "Freinage",
      result: "OK" as const,
      recommendedProductIds: [],
      recommendedLaborIds: [],
    },
    {
      category: "Pneumatiques",
      result: "WATCH" as const,
      recommendedProductIds: [],
      recommendedLaborIds: [],
    },
    {
      category: "Niveaux",
      result: "NOT_CHECKED" as const,
      recommendedProductIds: [],
      recommendedLaborIds: [],
    },
  ];
  it("pire résultat par catégorie", () => {
    expect(worstResult(["OK", "WATCH", "OK"])).toBe("WATCH");
    expect(worstResult(["OK", "URGENT", "WATCH"])).toBe("URGENT");
    expect(categoryResults(items)).toEqual([
      { category: "Freinage", result: "URGENT" },
      { category: "Pneumatiques", result: "WATCH" },
      { category: "Niveaux", result: "NOT_CHECKED" },
    ]);
  });
  it("résumé et points sans recommandation", () => {
    expect(summarizeInspection(items)).toEqual({
      urgent: 1,
      watch: 1,
      ok: 1,
      notChecked: 1,
      withoutRecommendation: 1,
      withRecommendation: 1,
    });
  });
  it("DIAGNOSING → AWAITING_APPROVAL seulement avec recommandations", () => {
    const summary = summarizeInspection(items);
    expect(statusAfterInspection("DIAGNOSING", summary)).toBe("AWAITING_APPROVAL");
    expect(statusAfterInspection("DIAGNOSING", summarizeInspection(items.slice(1)))).toBe(
      "DIAGNOSING",
    );
    expect(statusAfterInspection("IN_PROGRESS", summary)).toBe("IN_PROGRESS");
  });
});

describe("promesse de restitution (RG-M04-10)", () => {
  it("avant 11:00 et ≤ 4 h → aujourd'hui 17:00 ; sinon J+1 17:00 (dimanche sauté)", () => {
    expect(suggestPromisedAt(new Date("2026-10-19T09:30:00Z"), "Africa/Abidjan", 2)).toEqual(
      new Date("2026-10-19T17:00:00Z"),
    );
    expect(suggestPromisedAt(new Date("2026-10-19T11:30:00Z"), "Africa/Abidjan", 2)).toEqual(
      new Date("2026-10-20T17:00:00Z"),
    );
    expect(suggestPromisedAt(new Date("2026-10-19T09:30:00Z"), "Africa/Abidjan", 6)).toEqual(
      new Date("2026-10-20T17:00:00Z"),
    );
    // Samedi 24/10 après-midi → lundi 26/10 17:00
    expect(suggestPromisedAt(new Date("2026-10-24T15:00:00Z"), "Africa/Abidjan", 1)).toEqual(
      new Date("2026-10-26T17:00:00Z"),
    );
  });
  it("retard : promesse dépassée et statut < READY", () => {
    const promisedAt = new Date("2026-10-19T17:00:00Z");
    const now = new Date("2026-10-19T18:00:00Z");
    expect(isLate({ status: "IN_PROGRESS", promisedAt }, now)).toBe(true);
    expect(isLate({ status: "READY", promisedAt }, now)).toBe(false);
    expect(isLate({ status: "CANCELLED", promisedAt }, now)).toBe(false);
    expect(isLate({ status: "IN_PROGRESS", promisedAt: null }, now)).toBe(false);
  });
});

describe("settings & QC (RG-M04-13)", () => {
  it("valeurs par défaut et surcharge partielle", () => {
    expect(repairOrderSettingsFrom({})).toMatchObject({ minCheckInPhotos: 4, qcRequired: true });
    expect(
      repairOrderSettingsFrom({ repairOrders: { minCheckInPhotos: 0, qcRequired: false } }),
    ).toMatchObject({ minCheckInPhotos: 0, qcRequired: false, storageFeePerDay: 2_000 });
  });
  it("un NOK ou un point manquant interdit READY", () => {
    const list = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ];
    expect(
      evaluateQc(list, [
        { key: "a", result: "OK" },
        { key: "b", result: "NA" },
      ]).ok,
    ).toBe(true);
    expect(
      evaluateQc(list, [
        { key: "a", result: "OK" },
        { key: "b", result: "NOK" },
      ]),
    ).toEqual({
      ok: false,
      nok: ["b"],
      missing: [],
    });
    expect(evaluateQc(list, [{ key: "a", result: "OK" }]).missing).toEqual(["b"]);
  });
});

describe("canTransition (§5)", () => {
  const all = new Set([
    "repair_order:create",
    "repair_order:update",
    "repair_order:assign",
    "repair_order:qc",
    "repair_order:deliver",
    "repair_order:cancel",
    "repair_order:reopen",
  ]);
  const ctx: TransitionContext = { permissions: all, qcRequired: true };
  const approved: TransitionLine = { type: "LABOR", status: "PENDING", approval: "APPROVED" };
  const done: TransitionLine = { ...approved, status: "DONE" };
  const pending: TransitionLine = { ...approved, approval: "PENDING" };

  it("transitions nominales du parcours", () => {
    const steps: [
      Parameters<typeof canTransition>[0]["status"],
      Parameters<typeof canTransition>[2],
      TransitionLine[],
      string,
    ][] = [
      ["DRAFT", "check_in", [], "CHECKED_IN"],
      ["CHECKED_IN", "start_diagnosis", [], "DIAGNOSING"],
      ["DIAGNOSING", "request_approval", [pending], "AWAITING_APPROVAL"],
      ["AWAITING_APPROVAL", "approve", [approved], "APPROVED"],
      ["CHECKED_IN", "approve", [approved], "APPROVED"],
      ["APPROVED", "start_work", [approved], "IN_PROGRESS"],
      ["WAITING_PARTS", "resume", [approved], "IN_PROGRESS"],
      ["IN_PROGRESS", "complete_work", [done], "QUALITY_CHECK"],
      ["QUALITY_CHECK", "qc_reject", [done], "IN_PROGRESS"],
      ["READY", "deliver", [done], "DELIVERED"],
      ["DELIVERED", "reopen", [done], "READY"],
      ["AWAITING_APPROVAL", "decline_all", [], "READY"],
    ];
    for (const [status, transition, lines, to] of steps) {
      expect(
        canTransition({ status }, lines, transition, { ...ctx, reason: "motif", qcPassed: true }),
        `${status} ${transition}`,
      ).toEqual({ ok: true, to });
    }
    expect(
      canTransition({ status: "QUALITY_CHECK" }, [done], "qc_pass", { ...ctx, qcPassed: true }),
    ).toEqual({ ok: true, to: "READY" });
    expect(
      canTransition({ status: "IN_PROGRESS" }, [], "wait_parts", {
        ...ctx,
        unavailablePartLines: 1,
      }),
    ).toEqual({ ok: true, to: "WAITING_PARTS" });
    expect(
      canTransition({ status: "DELIVERED" }, [], "invoice_issued", {
        permissions: new Set(),
        system: true,
      }),
    ).toEqual({ ok: true, to: "INVOICED" });
  });

  it("QC désactivé : complete_work → READY", () => {
    expect(
      canTransition({ status: "IN_PROGRESS" }, [done], "complete_work", {
        ...ctx,
        qcRequired: false,
      }),
    ).toEqual({
      ok: true,
      to: "READY",
    });
  });

  it("refuse une transition interdite depuis le statut courant (kanban)", () => {
    expect(canTransition({ status: "APPROVED" }, [approved], "qc_pass", ctx)).toMatchObject({
      ok: false,
      code: "INVALID_FROM_STATUS",
      message: "Action impossible : l'OR est « Approuvé ».",
    });
    expect(canTransition({ status: "INVOICED" }, [], "reopen", { ...ctx, reason: "x" }).ok).toBe(
      false,
    );
  });

  it("refuse sans permission, sauf transition système", () => {
    expect(
      canTransition({ status: "QUALITY_CHECK" }, [done], "qc_pass", {
        permissions: new Set(["repair_order:update"]),
        qcPassed: true,
      }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      canTransition({ status: "QUALITY_CHECK" }, [done], "qc_pass", {
        permissions: new Set(),
        system: true,
        qcPassed: true,
      }).ok,
    ).toBe(true);
  });

  it("gardes : lignes en attente d'accord", () => {
    expect(
      canTransition({ status: "AWAITING_APPROVAL" }, [approved, pending, pending], "approve", ctx),
    ).toEqual({
      ok: false,
      code: "PENDING_LINES",
      message: "2 lignes attendent l'accord du client.",
    });
    expect(canTransition({ status: "CHECKED_IN" }, [], "approve", ctx)).toMatchObject({
      code: "NO_APPROVED_LINE",
    });
    expect(
      canTransition({ status: "DIAGNOSING" }, [approved], "request_approval", ctx),
    ).toMatchObject({
      code: "NO_PENDING_LINE",
    });
    expect(
      canTransition({ status: "IN_PROGRESS" }, [done, pending], "complete_work", ctx),
    ).toMatchObject({
      code: "PENDING_LINES",
    });
  });

  it("gardes : lignes non terminées et pointage ouvert", () => {
    expect(
      canTransition({ status: "IN_PROGRESS" }, [approved], "complete_work", ctx),
    ).toMatchObject({
      code: "LINES_NOT_DONE",
      message: "1 ligne n'est pas terminée.",
    });
    expect(
      canTransition({ status: "IN_PROGRESS" }, [done], "complete_work", {
        ...ctx,
        openTimeEntries: 1,
        openTimeEntryName: "Coulibaly Drissa",
      }),
    ).toMatchObject({
      code: "OPEN_TIME_ENTRY",
      message: "Clôturez le pointage de Coulibaly Drissa avant de terminer.",
    });
    // Une ligne annulée ou refusée ne bloque pas.
    expect(
      canTransition(
        { status: "IN_PROGRESS" },
        [done, { ...approved, status: "CANCELLED" }, { ...approved, approval: "DECLINED" }],
        "complete_work",
        ctx,
      ).ok,
    ).toBe(true);
  });

  it("gardes : QC NOK, facture émise, pièces sorties, motif", () => {
    expect(
      canTransition({ status: "QUALITY_CHECK" }, [done], "qc_pass", { ...ctx, qcPassed: false }),
    ).toMatchObject({
      code: "QC_NOK",
    });
    expect(canTransition({ status: "QUALITY_CHECK" }, [done], "qc_reject", ctx)).toMatchObject({
      code: "REASON_REQUIRED",
    });
    expect(
      canTransition({ status: "DELIVERED" }, [done], "reopen", {
        ...ctx,
        reason: "x",
        hasIssuedInvoice: true,
      }),
    ).toMatchObject({ code: "INVOICE_ISSUED" });
    expect(
      canTransition({ status: "APPROVED" }, [approved], "cancel", {
        ...ctx,
        reason: "Doublon",
        issuedPartsNotReturned: 2,
      }),
    ).toMatchObject({ code: "ISSUED_PARTS" });
    expect(
      canTransition({ status: "IN_PROGRESS" }, [approved], "cancel", {
        ...ctx,
        reason: "Doublon",
        openTimeEntries: 1,
        openTimeEntryName: "Coulibaly Drissa",
      }),
    ).toMatchObject({ message: "Clôturez le pointage de Coulibaly Drissa avant d'annuler." });
    expect(canTransition({ status: "APPROVED" }, [approved], "cancel", ctx)).toMatchObject({
      code: "REASON_REQUIRED",
    });
    expect(
      canTransition({ status: "READY" }, [approved], "cancel", { ...ctx, reason: "x" }).ok,
    ).toBe(false);
    expect(canTransition({ status: "APPROVED" }, [], "wait_parts", ctx)).toMatchObject({
      code: "NO_UNAVAILABLE_PART",
    });
  });

  it("retour sur travaux : décision de garantie obligatoire avant APPROVED", () => {
    expect(
      canTransition({ status: "CHECKED_IN", isComeback: true }, [approved], "approve", ctx),
    ).toMatchObject({
      code: "WARRANTY_DECISION_REQUIRED",
    });
    expect(
      canTransition(
        { status: "CHECKED_IN", isComeback: true, warrantyDecision: "COVERED" },
        [approved],
        "approve",
        ctx,
      ).ok,
    ).toBe(true);
  });

  it("restitution depuis QUALITY_CHECK : MANAGER + motif", () => {
    expect(canTransition({ status: "QUALITY_CHECK" }, [done], "deliver", ctx)).toMatchObject({
      code: "REASON_REQUIRED",
    });
    expect(
      canTransition({ status: "QUALITY_CHECK" }, [done], "deliver", {
        ...ctx,
        reason: "Urgence client",
        forceFromQualityCheck: true,
      }),
    ).toEqual({ ok: true, to: "DELIVERED" });
    expect(
      canTransition({ status: "QUALITY_CHECK" }, [done], "deliver", {
        permissions: new Set(["repair_order:deliver"]),
        reason: "x",
        forceFromQualityCheck: true,
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
  });

  it("actions disponibles selon statut et permissions", () => {
    const actions = availableTransitions({ status: "IN_PROGRESS" }, [approved], ctx);
    expect(actions.map((a) => a.transition)).toEqual([
      "request_approval",
      "wait_parts",
      "complete_work",
      "cancel",
    ]);
    expect(actions.find((a) => a.transition === "complete_work")).toMatchObject({ ok: false });
    expect(
      availableTransitions({ status: "QUALITY_CHECK" }, [done], {
        permissions: new Set(["repair_order:update"]),
      }),
    ).toEqual([]);
  });

  it("frise publique", () => {
    expect(timelineIndex("CHECKED_IN")).toBe(0);
    expect(timelineIndex("WAITING_PARTS")).toBe(3);
    expect(timelineIndex("READY")).toBe(5);
    expect(timelineIndex("DRAFT")).toBe(-1);
  });
});
