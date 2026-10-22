import { describe, expect, it } from "vitest";
import {
  accountBalance,
  checkAccount,
  checkArchive,
  checkManualMovement,
  checkReversal,
  checkTransfer,
  maskAccountRef,
  periodBuckets,
  periodReport,
  planProjection,
  reconcile,
  resolveMethodAccount,
  type AccountLike,
  type ProjectionInput,
} from "./index";

const TZ = "Africa/Abidjan";
const D = (iso: string) => new Date(iso);
const opening = D("2026-10-01T00:00:00.000Z");

const register: AccountLike = {
  id: "reg-yop",
  name: "Caisse Yopougon",
  type: "CASH_REGISTER",
  siteId: "yop",
  paymentMethods: [],
  openingDate: opening,
  archivedAt: null,
};
const safe: AccountLike = { ...register, id: "safe", name: "Coffre", type: "SAFE", siteId: null };
const bank: AccountLike = {
  ...register,
  id: "bank",
  name: "SGBCI",
  type: "BANK",
  siteId: null,
  paymentMethods: ["BANK_TRANSFER", "CARD", "CHEQUE"],
};
const wave: AccountLike = {
  ...register,
  id: "wave",
  name: "Wave marchand",
  type: "MOBILE_MONEY",
  siteId: null,
  paymentMethods: ["WAVE"],
  openingDate: D("2026-10-15T00:00:00.000Z"),
};
const accounts = [register, safe, bank, wave];

const base: ProjectionInput = {
  timeZone: TZ,
  now: D("2026-10-22T12:00:00.000Z"),
  accounts,
  payments: [],
  refunds: [],
  expenses: [],
  drops: [],
  sessions: [],
  posted: [],
};

const payment = (over: Partial<ProjectionInput["payments"][number]>) => ({
  id: "p1",
  number: "REC-2026-000001",
  method: "CASH",
  amount: 85_000,
  status: "CONFIRMED",
  voidedAt: null,
  receivedAt: D("2026-10-20T09:00:00.000Z"),
  siteId: "yop",
  customerName: "Kouassi Jean-Marc",
  reference: null,
  ...over,
});

describe("RG-M18-02 — rattachement des modes de paiement", () => {
  it("envoie les espèces à la caisse du site et les autres modes au compte rattaché", () => {
    expect(resolveMethodAccount("CASH", "yop", accounts)?.id).toBe("reg-yop");
    expect(resolveMethodAccount("CASH", "coc", accounts)).toBeNull();
    expect(resolveMethodAccount("WAVE", "yop", accounts)?.id).toBe("wave");
    expect(resolveMethodAccount("CHEQUE", "yop", accounts)?.id).toBe("bank");
    expect(resolveMethodAccount("ORANGE_MONEY", "yop", accounts)).toBeNull();
  });

  it("ignore un compte archivé", () => {
    expect(
      resolveMethodAccount("WAVE", "yop", [{ ...wave, archivedAt: D("2026-10-21") }]),
    ).toBeNull();
  });
});

describe("RG-M18-01/02 — validation d'un compte", () => {
  const draft = {
    name: "Orange Money",
    type: "MOBILE_MONEY" as const,
    siteId: null,
    paymentMethods: ["ORANGE_MONEY"],
  };

  it("accepte un compte valide", () => {
    expect(() =>
      checkAccount({ account: draft, others: accounts, openingBalance: 0 }),
    ).not.toThrow();
  });

  it("refuse un nom déjà pris (casse ignorée) ou vide", () => {
    expect(() =>
      checkAccount({ account: { ...draft, name: "coffre" }, others: accounts, openingBalance: 0 }),
    ).toThrow(/existe déjà/);
    expect(() =>
      checkAccount({ account: { ...draft, name: "  " }, others: accounts, openingBalance: 0 }),
    ).toThrow(/nom/);
  });

  it("refuse un mode déjà rattaché à un autre compte, mais pas au compte lui-même", () => {
    expect(() =>
      checkAccount({
        account: { ...draft, paymentMethods: ["WAVE"] },
        others: accounts,
        openingBalance: 0,
      }),
    ).toThrow(/Wave est déjà rattaché au compte « Wave marchand »/);
    expect(() =>
      checkAccount({
        account: { ...draft, id: "wave", name: "Wave", paymentMethods: ["WAVE"] },
        others: accounts,
        openingBalance: 0,
      }),
    ).not.toThrow();
  });

  it("refuse CASH rattaché, une caisse sans site ou en double", () => {
    expect(() =>
      checkAccount({
        account: { ...draft, paymentMethods: ["CASH"] },
        others: accounts,
        openingBalance: 0,
      }),
    ).toThrow(/caisse du site/);
    expect(() =>
      checkAccount({
        account: { name: "Caisse 2", type: "CASH_REGISTER", siteId: null, paymentMethods: [] },
        others: accounts,
        openingBalance: 0,
      }),
    ).toThrow(/rattachée à un site/);
    expect(() =>
      checkAccount({
        account: { name: "Caisse bis", type: "CASH_REGISTER", siteId: "yop", paymentMethods: [] },
        others: accounts,
        openingBalance: 0,
      }),
    ).toThrow(/déjà une caisse/);
  });

  it("archivage : seulement soldé, jamais une caisse", () => {
    expect(() => checkArchive(1_000, "BANK")).toThrow(/Soldez le compte/);
    expect(() => checkArchive(0, "CASH_REGISTER")).toThrow(/ne peut pas être archivée/);
    expect(() => checkArchive(0, "BANK")).not.toThrow();
  });

  it("masque le numéro de compte", () => {
    expect(maskAccountRef("CI008 01234 000123456789 12")).toBe("•••• 8912");
    expect(maskAccountRef("123")).toBe("123");
    expect(maskAccountRef(null)).toBeNull();
  });
});

describe("RG-M18-03 — projection du grand livre", () => {
  it("passe un encaissement espèces dans la caisse du site", () => {
    const { movements, unassigned } = planProjection({ ...base, payments: [payment({})] });
    expect(unassigned).toEqual([]);
    expect(movements).toEqual([
      expect.objectContaining({
        accountId: "reg-yop",
        direction: "IN",
        kind: "PAYMENT",
        amount: 85_000,
        category: "CASH",
        sourceType: "payment",
        sourceId: "p1",
        label: "Espèces REC-2026-000001 — Kouassi Jean-Marc",
      }),
    ]);
  });

  it("est idempotent : un mouvement déjà passé n'est pas repassé", () => {
    const { movements } = planProjection({
      ...base,
      payments: [payment({})],
      posted: [{ accountId: "reg-yop", sourceType: "payment", sourceId: "p1", kind: "PAYMENT" }],
    });
    expect(movements).toEqual([]);
  });

  it("ignore les chèques en attente, et un paiement antérieur à l'ouverture du compte", () => {
    const { movements } = planProjection({
      ...base,
      payments: [
        payment({ id: "chq", method: "CHEQUE", status: "PENDING" }),
        // Compte Wave ouvert le 15/10 : paiement du 14/10 non projeté.
        payment({ id: "w-old", method: "WAVE", receivedAt: D("2026-10-14T18:00:00.000Z") }),
        payment({ id: "w-new", method: "WAVE", receivedAt: D("2026-10-15T08:00:00.000Z") }),
      ],
    });
    expect(movements.map((m) => m.sourceId)).toEqual(["w-new"]);
  });

  it("signale un mode sans compte rattaché", () => {
    const { movements, unassigned } = planProjection({
      ...base,
      payments: [payment({ id: "om", method: "ORANGE_MONEY", amount: 60_000 })],
    });
    expect(movements).toEqual([]);
    expect(unassigned).toEqual([
      {
        sourceType: "payment",
        sourceId: "om",
        method: "ORANGE_MONEY",
        amount: 60_000,
        reason: "no_account",
      },
    ]);
  });

  it("contre-passe un paiement annulé après projection, sur le même compte", () => {
    const voidedAt = D("2026-10-21T10:00:00.000Z");
    const { movements } = planProjection({
      ...base,
      payments: [payment({ voidedAt })],
      posted: [{ accountId: "reg-yop", sourceType: "payment", sourceId: "p1", kind: "PAYMENT" }],
    });
    expect(movements).toEqual([
      expect.objectContaining({
        accountId: "reg-yop",
        direction: "OUT",
        kind: "PAYMENT_REVERSAL",
        occurredAt: voidedAt,
      }),
    ]);
    // Annulé avant projection : rien du tout.
    expect(planProjection({ ...base, payments: [payment({ voidedAt })] }).movements).toEqual([]);
  });

  it("passe remboursements, dépenses validées (caisse ou compte) et écarts de clôture", () => {
    const { movements } = planProjection({
      ...base,
      refunds: [
        {
          id: "r1",
          method: "WAVE",
          amount: 5_000,
          createdAt: D("2026-10-20T11:00:00.000Z"),
          siteId: "yop",
          reason: "Trop-perçu",
          reference: "T_1",
        },
      ],
      expenses: [
        {
          id: "e1",
          amount: 12_500,
          category: "Carburant",
          description: "Essai",
          paidAt: D("2026-10-20T10:00:00.000Z"),
          siteId: "yop",
          cashSessionId: "s1",
          treasuryAccountId: null,
          status: "APPROVED",
        },
        {
          id: "e2",
          amount: 350_000,
          category: "Loyer",
          description: "Octobre",
          paidAt: D("2026-10-05T10:00:00.000Z"),
          siteId: "yop",
          cashSessionId: null,
          treasuryAccountId: "bank",
          status: "APPROVED",
        },
        {
          id: "e3",
          amount: 40_000,
          category: "Transport",
          description: "En attente",
          paidAt: D("2026-10-20T10:00:00.000Z"),
          siteId: "yop",
          cashSessionId: "s1",
          treasuryAccountId: null,
          status: "PENDING",
        },
      ],
      sessions: [
        { id: "s1", siteId: "yop", closedAt: D("2026-10-20T18:00:00.000Z"), difference: -2_500 },
        { id: "s0", siteId: "yop", closedAt: D("2026-10-19T18:00:00.000Z"), difference: 0 },
      ],
    });
    expect(movements.map((m) => [m.kind, m.accountId, m.direction, m.amount])).toEqual([
      ["REFUND", "wave", "OUT", 5_000],
      ["EXPENSE", "reg-yop", "OUT", 12_500],
      ["EXPENSE", "bank", "OUT", 350_000],
      ["CASH_VARIANCE", "reg-yop", "OUT", 2_500],
    ]);
  });

  it("passe un versement de caisse en sortie caisse + entrée du compte choisi (ou par défaut)", () => {
    const at = D("2026-10-20T15:00:00.000Z");
    const { movements } = planProjection({
      ...base,
      drops: [
        {
          id: "d1",
          amount: 40_000,
          createdAt: at,
          siteId: "yop",
          destination: "safe",
          toAccountId: null,
          reference: null,
        },
        {
          id: "d2",
          amount: 100_000,
          createdAt: at,
          siteId: "yop",
          destination: "bank",
          toAccountId: "bank",
          reference: "BV-1",
        },
      ],
    });
    expect(
      movements.map((m) => [m.sourceId, m.accountId, m.direction, m.counterpartAccountId]),
    ).toEqual([
      ["d1", "reg-yop", "OUT", "safe"],
      ["d1", "safe", "IN", "reg-yop"],
      ["d2", "reg-yop", "OUT", "bank"],
      ["d2", "bank", "IN", "reg-yop"],
    ]);
  });

  it("signale un versement sans compte de destination", () => {
    const { movements, unassigned } = planProjection({
      ...base,
      accounts: [register],
      drops: [
        {
          id: "d1",
          amount: 40_000,
          createdAt: D("2026-10-20T15:00:00.000Z"),
          siteId: "yop",
          destination: "bank",
          toAccountId: null,
          reference: null,
        },
      ],
    });
    expect(movements.map((m) => m.direction)).toEqual(["OUT"]);
    expect(unassigned[0]).toMatchObject({ reason: "no_destination", amount: 40_000 });
  });
});

describe("RG-M18-04/05/06/07 — soldes, virements, mouvements, rapprochement", () => {
  it("calcule un solde", () => {
    expect(accountBalance(100_000, 50_000, 30_000)).toBe(120_000);
  });

  it("refuse un virement invalide ou supérieur au solde (sauf banque)", () => {
    expect(() => checkTransfer({ from: safe, to: safe, amount: 1, fromBalance: 10 })).toThrow(
      /deux comptes différents/,
    );
    expect(() => checkTransfer({ from: safe, to: bank, amount: 0, fromBalance: 10 })).toThrow(
      /entier positif/,
    );
    expect(() =>
      checkTransfer({ from: safe, to: bank, amount: 600_000, fromBalance: 500_000 }),
    ).toThrow(/Solde insuffisant sur « Coffre » \(500 000 FCFA disponibles\)/);
    expect(() =>
      checkTransfer({ from: bank, to: safe, amount: 600_000, fromBalance: 500_000 }),
    ).not.toThrow();
    expect(() =>
      checkTransfer({
        from: safe,
        to: { ...bank, archivedAt: D("2026-10-21") },
        amount: 1,
        fromBalance: 10,
      }),
    ).toThrow(/archivé/);
    expect(() => checkTransfer({ from: null, to: bank, amount: 1, fromBalance: 10 })).toThrow(
      /introuvable/,
    );
  });

  it("valide un mouvement manuel", () => {
    const ok = {
      account: safe,
      direction: "IN" as const,
      kind: "INCOME" as const,
      amount: 100_000,
      category: "Apport du gérant",
      label: "Apport",
      balance: 0,
    };
    expect(() => checkManualMovement(ok)).not.toThrow();
    expect(() => checkManualMovement({ ...ok, direction: "OUT" })).toThrow(/augmente le solde/);
    expect(() => checkManualMovement({ ...ok, kind: "PAYMENT" })).toThrow(/Seules les entrées/);
    expect(() => checkManualMovement({ ...ok, label: "x" })).toThrow(/Décrivez/);
    expect(() => checkManualMovement({ ...ok, category: " " })).toThrow(/catégorie/);
    expect(() =>
      checkManualMovement({
        ...ok,
        kind: "ADJUSTMENT",
        direction: "OUT",
        amount: 5_000,
        balance: 1_000,
      }),
    ).toThrow(/Solde insuffisant/);
  });

  it("ne contre-passe que les mouvements manuels et virements, une seule fois, avec motif", () => {
    expect(() =>
      checkReversal({ kind: "PAYMENT", reversalOfId: null, alreadyReversed: false }, "Erreur"),
    ).toThrow(/corrigez sa source/);
    expect(() =>
      checkReversal({ kind: "INCOME", reversalOfId: "m0", alreadyReversed: false }, "Erreur"),
    ).toThrow(/ne se contre-passe pas/);
    expect(() =>
      checkReversal({ kind: "INCOME", reversalOfId: null, alreadyReversed: true }, "Erreur"),
    ).toThrow(/déjà contre-passé/);
    expect(() =>
      checkReversal({ kind: "INCOME", reversalOfId: null, alreadyReversed: false }, " "),
    ).toThrow(/motif/);
    expect(() =>
      checkReversal({ kind: "TRANSFER", reversalOfId: null, alreadyReversed: false }, "Doublon"),
    ).not.toThrow();
  });

  it("rapproche un relevé", () => {
    expect(reconcile(1_250_000, 1_262_500)).toEqual({ difference: -12_500, balanced: false });
    expect(reconcile(500, 500)).toEqual({ difference: 0, balanced: true });
  });
});

describe("RG-M18-08 — rapports par période", () => {
  it("génère toutes les périodes, y compris vides", () => {
    expect(periodBuckets("2026-10-30", "2026-11-02", "day")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(periodBuckets("2026-10-21", "2026-11-04", "week")).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ]);
    expect(periodBuckets("2026-11-15", "2027-01-03", "month")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });

  const movements = [
    {
      accountId: "reg-yop",
      direction: "IN" as const,
      kind: "PAYMENT" as const,
      amount: 85_000,
      occurredAt: D("2026-10-20T09:00:00.000Z"),
      category: "CASH",
    },
    {
      accountId: "wave",
      direction: "IN" as const,
      kind: "PAYMENT" as const,
      amount: 145_000,
      occurredAt: D("2026-10-21T09:00:00.000Z"),
      category: "WAVE",
    },
    {
      accountId: "reg-yop",
      direction: "OUT" as const,
      kind: "EXPENSE" as const,
      amount: 12_500,
      occurredAt: D("2026-10-21T10:00:00.000Z"),
      category: "Carburant",
    },
    {
      accountId: "reg-yop",
      direction: "OUT" as const,
      kind: "CASH_DROP" as const,
      amount: 40_000,
      occurredAt: D("2026-10-21T15:00:00.000Z"),
      category: null,
    },
    {
      accountId: "safe",
      direction: "IN" as const,
      kind: "CASH_DROP" as const,
      amount: 40_000,
      occurredAt: D("2026-10-21T15:00:00.000Z"),
      category: null,
    },
    {
      accountId: "wave",
      direction: "OUT" as const,
      kind: "REFUND" as const,
      amount: 5_000,
      occurredAt: D("2026-10-22T09:00:00.000Z"),
      category: "WAVE",
    },
  ];

  it("vue tous comptes : exclut les mouvements internes", () => {
    const r = periodReport({
      opening: 100_000,
      movements,
      from: "2026-10-20",
      to: "2026-10-22",
      groupBy: "day",
      timeZone: TZ,
      excludeInternal: true,
    });
    expect(r).toMatchObject({
      opening: 100_000,
      inflow: 230_000,
      outflow: 17_500,
      net: 212_500,
      closing: 312_500,
    });
    expect(r.series).toEqual([
      { key: "2026-10-20", inflow: 85_000, outflow: 0, net: 85_000 },
      { key: "2026-10-21", inflow: 145_000, outflow: 12_500, net: 132_500 },
      { key: "2026-10-22", inflow: 0, outflow: 5_000, net: -5_000 },
    ]);
    expect(r.inflowByMethod).toEqual([
      { method: "WAVE", amount: 145_000 },
      { method: "CASH", amount: 85_000 },
    ]);
    expect(r.outflowByCategory).toEqual([
      { category: "Carburant", amount: 12_500 },
      { category: "Remboursements clients", amount: 5_000 },
    ]);
  });

  it("vue d'un compte : garde les versements", () => {
    const caisse = movements.filter((m) => m.accountId === "reg-yop");
    const r = periodReport({
      opening: 50_000,
      movements: caisse,
      from: "2026-10-01",
      to: "2026-10-31",
      groupBy: "month",
      timeZone: TZ,
      excludeInternal: false,
    });
    expect(r).toMatchObject({ inflow: 85_000, outflow: 52_500, closing: 82_500 });
    expect(r.series).toEqual([{ key: "2026-10", inflow: 85_000, outflow: 52_500, net: 32_500 }]);
    expect(r.outflowByKind).toEqual([
      { kind: "CASH_DROP", amount: 40_000 },
      { kind: "EXPENSE", amount: 12_500 },
    ]);
  });
});
