import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createContext } from "../context";
import { setReceivablesClock } from "../receivables/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

vi.mock("../messaging/queue", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;
type Role = "OWNER" | "MANAGER" | "CASHIER" | "ACCOUNTANT";

// Horloge figée : 21/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-21T10:00:00.000Z");
const TODAY = "2026-10-21";

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}`, "x-forwarded-for": "41.202.10.77" },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

const users: string[] = [];

async function member(organizationId: string, role: Role) {
  const user = await adminDb.user.create({
    data: {
      name: `${role} ${randomBytes(2).toString("hex")}`,
      email: `${randomBytes(5).toString("hex")}@example.com`,
    },
  });
  users.push(user.id);
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds: [] },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  return { membershipId: membership.id, caller: callerFactory(await contextFor(token)) };
}

describe("M18 — trésorerie", () => {
  const orgIds: string[] = [];
  let orgA: { id: string };
  let siteA: { id: string };
  let owner: Caller;
  let manager: Caller;
  let accountant: Caller;
  let cashier: { membershipId: string; caller: Caller };
  let callerB: Caller;
  let seq = 0;

  async function payment(
    method: "CASH" | "WAVE" | "BANK_TRANSFER",
    amount: number,
    sessionId?: string,
  ) {
    seq += 1;
    return adminDb.payment.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        number: `REC-T-${randomBytes(3).toString("hex")}-${seq}`,
        method,
        amount,
        receivedAt: NOW,
        reference: method === "CASH" ? null : `REF${seq}${randomBytes(2).toString("hex")}`,
        cashSessionId: sessionId ?? null,
        receivedById: cashier.membershipId,
      },
    });
  }

  const balanceOf = async (name: string) =>
    (await owner.treasury.overview()).accounts.find((a) => a.name === name)!.balance;

  beforeAll(async () => {
    setReceivablesClock(fixedClock(NOW));
    // Organisation créée début octobre : la caisse et le coffre par défaut s'ouvrent le 01/10.
    orgA = await adminDb.organization.create({
      data: {
        name: "Garage Trésorerie A",
        onboardingCompletedAt: NOW,
        createdAt: new Date("2026-10-01T08:00:00.000Z"),
      },
    });
    const orgB = await adminDb.organization.create({
      data: { name: "Garage Trésorerie B", onboardingCompletedAt: NOW },
    });
    orgIds.push(orgA.id, orgB.id);
    siteA = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" },
    });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    owner = (await member(orgA.id, "OWNER")).caller;
    manager = (await member(orgA.id, "MANAGER")).caller;
    accountant = (await member(orgA.id, "ACCOUNTANT")).caller;
    cashier = await member(orgA.id, "CASHIER");
    callerB = (await member(orgB.id, "OWNER")).caller;
  });

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await adminDb.treasuryMovement.deleteMany({ where });
    await adminDb.treasuryTransfer.deleteMany({ where });
    await adminDb.treasuryReconciliation.deleteMany({ where });
    await adminDb.attachment.deleteMany({ where });
    await adminDb.payment.deleteMany({ where });
    await adminDb.cashDrop.deleteMany({ where });
    await adminDb.expense.deleteMany({ where });
    await adminDb.treasuryAccount.deleteMany({ where });
    await adminDb.cashSession.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("crée caisse et coffre, projette les espèces, signale un mode sans compte, idempotent", async () => {
    const session = await cashier.caller.cash.open({ openingFloat: 0 });
    await payment("CASH", 100_000, session.id);
    await payment("WAVE", 85_000, session.id);
    const first = await owner.treasury.overview();
    expect(first.accounts.map((a) => [a.name, a.type])).toEqual([
      ["Caisse Yopougon", "CASH_REGISTER"],
      ["Coffre", "SAFE"],
    ]);
    expect(first.accounts[0]!.balance).toBe(100_000);
    expect(first.total).toBe(100_000);
    expect(first.alerts.unassigned).toEqual([{ method: "WAVE", count: 1, amount: 85_000 }]);
    await owner.treasury.overview();
    expect(await adminDb.treasuryMovement.count({ where: { organizationId: orgA.id } })).toBe(1);
  });

  it("comptes : création par le comptable, rattachement unique d'un mode, refus au gérant", async () => {
    await expect(
      manager.treasury.createAccount({
        name: "Wave",
        type: "MOBILE_MONEY",
        paymentMethods: ["WAVE"],
        openingDate: TODAY,
        openingBalance: 0,
      }),
    ).rejects.toThrow(/Permission manquante/);
    await accountant.treasury.createAccount({
      name: "Wave marchand",
      type: "MOBILE_MONEY",
      paymentMethods: ["WAVE"],
      accountRef: "0707070707",
      openingDate: TODAY,
      openingBalance: 0,
    });
    await expect(
      accountant.treasury.createAccount({
        name: "Wave 2",
        type: "MOBILE_MONEY",
        paymentMethods: ["WAVE"],
        openingDate: TODAY,
        openingBalance: 0,
      }),
    ).rejects.toThrow(/Wave est déjà rattaché au compte « Wave marchand »/);
    await accountant.treasury.createAccount({
      name: "SGBCI",
      type: "BANK",
      bankName: "Société Générale",
      accountRef: "CI008 01234 000123456789 12",
      paymentMethods: ["BANK_TRANSFER", "CARD", "CHEQUE"],
      openingDate: "2026-10-01",
      openingBalance: 1_000_000,
    });
    const overview = await owner.treasury.overview();
    expect(overview.alerts.unassigned).toEqual([]);
    const wave = overview.accounts.find((a) => a.name === "Wave marchand")!;
    expect(wave.balance).toBe(85_000);
    expect(wave.accountRef).toBe("•••• 0707");
    expect(overview.accounts.find((a) => a.name === "SGBCI")!.accountRef).toBe("•••• 8912");
    expect(overview.total).toBe(1_185_000);
  });

  it("versement de caisse vers la banque choisie : sortie caisse, entrée banque", async () => {
    const targets = await cashier.caller.cash.dropTargets();
    const bank = targets.find((t) => t.name === "SGBCI")!;
    const session = (await cashier.caller.cash.current({})).session!;
    await cashier.caller.cash.drop({
      sessionId: session.id,
      amount: 60_000,
      destination: "safe",
      toAccountId: bank.id,
    });
    expect(await balanceOf("Caisse Yopougon")).toBe(40_000);
    expect(await balanceOf("SGBCI")).toBe(1_060_000);
  });

  it("virements : solde insuffisant refusé (hors banque), contre-passation des deux jambes", async () => {
    const accounts = await owner.treasury.accounts();
    const id = (name: string) => accounts.find((a) => a.name === name)!.id;
    await expect(
      accountant.treasury.transfer({
        fromAccountId: id("Coffre"),
        toAccountId: id("SGBCI"),
        amount: 1_000,
      }),
    ).rejects.toThrow(/Solde insuffisant sur « Coffre »/);
    const t = await accountant.treasury.transfer({
      fromAccountId: id("SGBCI"),
      toAccountId: id("Coffre"),
      amount: 200_000,
      reference: "CHQ-0042",
      notes: "Retrait pour la paie",
    });
    expect(t.overdraft).toBe(false);
    expect(await balanceOf("Coffre")).toBe(200_000);
    expect(await balanceOf("SGBCI")).toBe(860_000);
    const journal = await owner.treasury.journal({ kind: "TRANSFER" });
    expect(journal.items).toHaveLength(2);
    await accountant.treasury.reverseMovement({
      id: journal.items[0]!.id,
      reason: "Saisie en double",
    });
    expect(await balanceOf("Coffre")).toBe(0);
    expect(await balanceOf("SGBCI")).toBe(1_060_000);
    await expect(
      accountant.treasury.reverseMovement({ id: journal.items[1]!.id, reason: "Encore" }),
    ).rejects.toThrow(/déjà contre-passé/);
  });

  it("mouvements manuels : entrée diverse, refus de contre-passer un encaissement", async () => {
    const accounts = await owner.treasury.accounts();
    const safe = accounts.find((a) => a.name === "Coffre")!;
    await accountant.treasury.createMovement({
      accountId: safe.id,
      kind: "INCOME",
      direction: "IN",
      amount: 500_000,
      category: "Apport du gérant",
      label: "Apport pour trésorerie",
    });
    expect(await balanceOf("Coffre")).toBe(500_000);
    const payments = await owner.treasury.journal({ kind: "PAYMENT" });
    await expect(
      accountant.treasury.reverseMovement({ id: payments.items[0]!.id, reason: "Erreur" }),
    ).rejects.toThrow(/corrigez sa source/);
  });

  it("dépense hors caisse : validée sous le seuil, en attente au-delà puis validée par le gérant", async () => {
    const accounts = await owner.treasury.accounts();
    const bank = accounts.find((a) => a.name === "SGBCI")!;
    const small = await accountant.treasury.expense({
      accountId: bank.id,
      category: "Frais bancaires",
      amount: 7_500,
      description: "Frais de tenue de compte",
    });
    expect(small.status).toBe("APPROVED");
    expect(await balanceOf("SGBCI")).toBe(1_052_500);
    const rent = await accountant.treasury.expense({
      accountId: bank.id,
      category: "Loyer",
      amount: 350_000,
      description: "Loyer octobre",
    });
    expect(rent.status).toBe("PENDING");
    expect(await balanceOf("SGBCI")).toBe(1_052_500);
    expect((await owner.treasury.overview()).alerts.pendingExpenses).toBe(1);
    await manager.cash.decideExpense({ id: rent.id, decision: "approve" });
    expect(await balanceOf("SGBCI")).toBe(702_500);
    const caisse = accounts.find((a) => a.type === "CASH_REGISTER")!;
    await expect(
      accountant.treasury.expense({
        accountId: caisse.id,
        category: "Loyer",
        amount: 1,
        description: "x",
      }),
    ).rejects.toThrow(/depuis la caisse du site/);
  });

  it("paiement annulé après projection : contre-écriture automatique", async () => {
    const p = await payment("BANK_TRANSFER", 120_000);
    expect(await balanceOf("SGBCI")).toBe(822_500);
    await adminDb.payment.update({
      where: { id: p.id },
      data: { voidedAt: NOW, voidReason: "Doublon" },
    });
    expect(await balanceOf("SGBCI")).toBe(702_500);
    const reversal = await owner.treasury.journal({ kind: "PAYMENT_REVERSAL" });
    expect(reversal.items[0]).toMatchObject({
      direction: "OUT",
      amount: 120_000,
      account: "SGBCI",
    });
  });

  it("rapprochement : écart calculé, ajustement facultatif avec motif", async () => {
    const accounts = await owner.treasury.accounts();
    const bank = accounts.find((a) => a.name === "SGBCI")!;
    await expect(
      accountant.treasury.reconcile({
        accountId: bank.id,
        statementDate: TODAY,
        statementBalance: 700_000,
        postAdjustment: true,
      }),
    ).rejects.toThrow(/motif/);
    const rec = await accountant.treasury.reconcile({
      accountId: bank.id,
      statementDate: TODAY,
      statementBalance: 700_000,
      notes: "Agios non saisis",
      postAdjustment: true,
    });
    expect(rec).toMatchObject({ computedBalance: 702_500, difference: -2_500 });
    expect(await balanceOf("SGBCI")).toBe(700_000);
    const detail = await owner.treasury.account({ id: bank.id });
    expect(detail.reconciliations[0]).toMatchObject({
      difference: -2_500,
      statementBalance: 700_000,
    });
    await expect(
      accountant.treasury.reconcile({
        accountId: bank.id,
        statementDate: "2026-10-30",
        statementBalance: 0,
      }),
    ).rejects.toThrow(/futur/);
  });

  it("journal filtré et rapport de période (virements internes exclus du total)", async () => {
    const search = await owner.treasury.journal({ q: "loyer" });
    expect(search.items.map((m) => m.label)).toEqual(["Loyer — Loyer octobre"]);
    const ins = await owner.treasury.journal({ flow: "IN", from: TODAY, to: TODAY });
    expect(ins.totals.inflow).toBe(ins.items.reduce((s, m) => s + m.amount, 0));
    const report = await manager.treasury.report({
      from: "2026-10-01",
      to: TODAY,
      groupBy: "week",
    });
    // Ouverture : banque 1 000 000 (ouverte le 01/10). Entrées réelles : 100 000 + 85 000 +
    // 120 000 + 500 000 ; sorties : 7 500 + 350 000 + 120 000 (annulation) + 2 500.
    expect(report.opening).toBe(1_000_000);
    expect(report.inflow).toBe(805_000);
    expect(report.outflow).toBe(480_000);
    expect(report.closing).toBe(1_325_000);
    expect(report.closing).toBe((await owner.treasury.overview()).total);
    expect(report.series.map((s) => s.key)).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(report.inflowByMethod).toEqual([
      { method: "BANK_TRANSFER", amount: 120_000 },
      { method: "CASH", amount: 100_000 },
      { method: "WAVE", amount: 85_000 },
    ]);
    expect(report.outflowByCategory[0]).toEqual({ category: "Loyer", amount: 350_000 });
    const bankReport = await manager.treasury.report({
      from: "2026-10-01",
      to: TODAY,
      accountId: report.accounts.find((a) => a.name === "SGBCI")!.id,
      groupBy: "month",
    });
    expect(bankReport.closing).toBe(700_000);
  });

  it("archivage seulement d'un compte soldé ; isolation multi-locataire", async () => {
    const accounts = await owner.treasury.accounts();
    const bank = accounts.find((a) => a.name === "SGBCI")!;
    await expect(accountant.treasury.archiveAccount({ id: bank.id })).rejects.toThrow(
      /Soldez le compte/,
    );
    expect((await callerB.treasury.journal({})).items).toHaveLength(0);
    await expect(callerB.treasury.account({ id: bank.id })).rejects.toThrow(/introuvable/);
    const other = await callerB.treasury.accounts();
    await expect(
      callerB.treasury.transfer({ fromAccountId: bank.id, toAccountId: other[0]!.id, amount: 1 }),
    ).rejects.toThrow(/introuvable/);
    await expect(
      callerB.treasury.reverseMovement({
        id: (await owner.treasury.journal({})).items[0]!.id,
        reason: "Test",
      }),
    ).rejects.toThrow(/introuvable/);
  });
});
