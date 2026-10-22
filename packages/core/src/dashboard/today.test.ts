import { describe, expect, it } from "vitest";
import type { ReceivableInvoiceLike } from "./receivables";
import {
  claimStage,
  countInspectionBands,
  countWorkshopStages,
  daysUntil,
  groupUpcomingReminders,
  inspectionBand,
  inspectionFollowUp,
  lastDays,
  summarizeClaimStages,
  summarizeUnpaid,
  weekStartDay,
  workshopStage,
  type ClaimStageInput,
  type InspectionReminderLike,
} from "./today";

const TODAY = "2026-10-22"; // jeudi
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("véhicules en atelier", () => {
  it("regroupe les statuts d'OR en 4 étapes", () => {
    expect(workshopStage("CHECKED_IN")).toBe("checkedIn");
    expect(workshopStage("DIAGNOSING")).toBe("diagnosis");
    expect(workshopStage("AWAITING_APPROVAL")).toBe("diagnosis");
    expect(workshopStage("APPROVED")).toBe("repair");
    expect(workshopStage("WAITING_PARTS")).toBe("repair");
    expect(workshopStage("QUALITY_CHECK")).toBe("repair");
    expect(workshopStage("READY")).toBe("ready");
  });

  it("ignore les OR hors atelier (brouillon, livré, facturé, annulé)", () => {
    for (const s of ["DRAFT", "DELIVERED", "INVOICED", "CANCELLED"]) {
      expect(workshopStage(s)).toBeNull();
    }
    expect(
      countWorkshopStages(["CHECKED_IN", "IN_PROGRESS", "IN_PROGRESS", "DRAFT", "READY"]),
    ).toEqual({
      checkedIn: 1,
      diagnosis: 0,
      repair: 2,
      ready: 1,
    });
  });
});

describe("visites techniques à préparer", () => {
  it("calcule les jours restants sur la date métier", () => {
    expect(daysUntil(d("2026-10-30"), TODAY)).toBe(8);
    expect(daysUntil(d(TODAY), TODAY)).toBe(0);
    expect(daysUntil(d("2026-10-20"), TODAY)).toBe(-2);
  });

  it("classe en J-15 / J-30 / J-60 aux bornes", () => {
    expect(inspectionBand(-3)).toBe("j15");
    expect(inspectionBand(0)).toBe("j15");
    expect(inspectionBand(15)).toBe("j15");
    expect(inspectionBand(16)).toBe("j30");
    expect(inspectionBand(30)).toBe("j30");
    expect(inspectionBand(31)).toBe("j60");
    expect(inspectionBand(60)).toBe("j60");
    expect(inspectionBand(61)).toBeNull();
    expect(countInspectionBands([3, 20, 45, 59, 90])).toEqual({ j15: 1, j30: 1, j60: 2 });
  });

  const r = (p: Partial<InspectionReminderLike>): InspectionReminderLike => ({
    status: "PLANNED",
    channel: "WHATSAPP",
    outcome: null,
    messageStatus: null,
    ...p,
  });

  it("donne l'état de relance le plus avancé", () => {
    expect(inspectionFollowUp([])).toBe("none");
    expect(inspectionFollowUp([r({})])).toBe("planned");
    expect(inspectionFollowUp([r({ status: "NEEDS_APPROVAL" })])).toBe("toApprove");
    expect(inspectionFollowUp([r({ status: "SENT", messageStatus: "DELIVERED" })])).toBe("sent");
    expect(inspectionFollowUp([r({ status: "SENT", messageStatus: "READ" })])).toBe("read");
    expect(inspectionFollowUp([r({ status: "NEEDS_APPROVAL", channel: null })])).toBe("toCall");
    expect(
      inspectionFollowUp([
        r({ status: "SENT", messageStatus: "READ" }),
        r({ status: "SENT", outcome: "APPOINTMENT_BOOKED" }),
      ]),
    ).toBe("booked");
  });
});

describe("relances à venir", () => {
  it("groupe par jour puis par type, du plus fréquent au moins fréquent", () => {
    expect(
      groupUpcomingReminders([
        { day: "2026-10-24", type: "INSPECTION" },
        { day: "2026-10-23", type: "RECEIVABLE" },
        { day: "2026-10-23", type: "INSPECTION" },
        { day: "2026-10-23", type: "INSPECTION" },
      ]),
    ).toEqual([
      {
        day: "2026-10-23",
        total: 3,
        byType: [
          { type: "INSPECTION", count: 2 },
          { type: "RECEIVABLE", count: 1 },
        ],
      },
      { day: "2026-10-24", total: 1, byType: [{ type: "INSPECTION", count: 1 }] },
    ]);
    expect(groupUpcomingReminders([])).toEqual([]);
  });

  it("trouve le lundi de la semaine, y compris le dimanche et le lundi", () => {
    expect(weekStartDay(TODAY)).toBe("2026-10-19");
    expect(weekStartDay("2026-10-19")).toBe("2026-10-19");
    expect(weekStartDay("2026-10-25")).toBe("2026-10-19");
    expect(weekStartDay("2026-11-01")).toBe("2026-10-26");
  });
});

describe("dossiers assurance par étape", () => {
  const c = (p: Partial<ClaimStageInput>): ClaimStageInput => ({
    status: "OPENED",
    estimateAmount: null,
    approvedAmount: null,
    insurerBalance: null,
    insurerDueDate: null,
    ...p,
  });

  it("classe chaque statut et prend le bon montant", () => {
    expect(claimStage(c({ status: "ESTIMATE_SENT", estimateAmount: 500_000 }), TODAY)).toEqual({
      stage: "awaitingApproval",
      amount: 500_000,
    });
    expect(claimStage(c({ status: "OPENED" }), TODAY)).toEqual({
      stage: "awaitingApproval",
      amount: 0,
    });
    expect(claimStage(c({ status: "REPAIRING", approvedAmount: 450_000 }), TODAY)).toEqual({
      stage: "approved",
      amount: 450_000,
    });
    expect(
      claimStage(
        c({ status: "INVOICED", insurerBalance: 300_000, insurerDueDate: d(TODAY) }),
        TODAY,
      ),
    ).toEqual({ stage: "invoiced", amount: 300_000 });
    expect(
      claimStage(
        c({ status: "PARTIALLY_PAID", insurerBalance: 100_000, insurerDueDate: d("2026-10-21") }),
        TODAY,
      ),
    ).toEqual({ stage: "late", amount: 100_000 });
  });

  it("exclut les dossiers clos, rejetés ou soldés", () => {
    for (const status of ["PAID", "REJECTED", "CANCELLED"]) {
      expect(claimStage(c({ status, approvedAmount: 1 }), TODAY)).toBeNull();
    }
    expect(claimStage(c({ status: "INVOICED", insurerBalance: 0 }), TODAY)).toBeNull();
  });

  it("totalise montants et nombres par étape", () => {
    const summary = summarizeClaimStages(
      [
        c({ status: "ESTIMATE_SENT", estimateAmount: 200_000 }),
        c({ status: "APPROVED", approvedAmount: 300_000 }),
        c({ status: "APPROVED", approvedAmount: 100_000 }),
        c({ status: "PAID" }),
      ],
      TODAY,
    );
    expect(summary.total).toBe(600_000);
    expect(summary.stages.approved).toEqual({ count: 2, amount: 400_000 });
    expect(summary.stages.late).toEqual({ count: 0, amount: 0 });
  });
});

describe("factures impayées", () => {
  const inv = (p: Partial<ReceivableInvoiceLike>): ReceivableInvoiceLike => ({
    id: Math.random().toString(36),
    type: "INVOICE",
    status: "ISSUED",
    billTo: "CUSTOMER",
    balance: 100_000,
    dueDate: d(TODAY),
    customerId: "c1",
    customerName: "Client",
    number: null,
    ...p,
  });

  it("compte l'encours client, les retards et les retards de plus de 15 jours", () => {
    const summary = summarizeUnpaid(
      [
        inv({ id: "a", balance: 320_000, dueDate: d("2026-10-03"), number: "FAC-1" }), // 19 j
        inv({ id: "b", balance: 215_000, dueDate: d("2026-10-06") }), // 16 j
        inv({ id: "c", balance: 180_000, dueDate: d("2026-10-07") }), // 15 j : pas > 15
        inv({ id: "d", balance: 95_000 }), // pas échue
        inv({ id: "e", billTo: "INSURANCE", dueDate: d("2026-01-01") }), // hors créances client
        inv({ id: "f", status: "DISPUTED", dueDate: d("2026-09-01") }), // litige : pas « en retard »
      ],
      TODAY,
      2,
    );
    expect(summary.total).toBe(320_000 + 215_000 + 180_000 + 95_000 + 100_000);
    expect(summary.count).toBe(5);
    expect(summary.overdueCount).toBe(3);
    expect(summary.longOverdueCount).toBe(2);
    expect(summary.overdue.map((i) => [i.id, i.daysOverdue])).toEqual([
      ["a", 19],
      ["b", 16],
    ]);
    expect(summary.more).toEqual({ count: 1, amount: 180_000 });
  });

  it("renvoie des zéros sans facture", () => {
    expect(summarizeUnpaid([], TODAY)).toMatchObject({
      total: 0,
      count: 0,
      overdueCount: 0,
      longOverdueCount: 0,
      overdue: [],
      more: { count: 0, amount: 0 },
    });
  });
});

describe("encaissements des derniers jours", () => {
  it("liste les jours du plus ancien à aujourd'hui, à travers un changement de mois", () => {
    expect(lastDays("2026-11-02", 4)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(lastDays(TODAY, 1)).toEqual([TODAY]);
  });
});
