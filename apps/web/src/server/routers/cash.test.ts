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
type Role = "OWNER" | "MANAGER" | "ADVISOR" | "CASHIER" | "ACCOUNTANT";

// Horloge figée : 21/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-21T10:00:00.000Z");

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}`, "x-forwarded-for": "41.202.10.77" },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

const users: string[] = [];

async function member(organizationId: string, role: Role, name?: string) {
  const user = await adminDb.user.create({
    data: {
      name: name ?? `${role} ${randomBytes(2).toString("hex")}`,
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

describe("M08 — caisse et clôture (validation des dépenses, Z, historique, réglages)", () => {
  const orgIds: string[] = [];
  let orgA: { id: string };
  let siteA: { id: string };
  let owner: Caller;
  let manager: Caller;
  let cashier: { membershipId: string; caller: Caller };
  let advisor: Caller;
  let callerB: Caller;
  let sessionId: string;
  let paymentSeq = 0;

  async function cashPayment(amount: number, method: "CASH" | "WAVE" = "CASH") {
    paymentSeq += 1;
    return adminDb.payment.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        number: `REC-TEST-${randomBytes(3).toString("hex")}-${paymentSeq}`,
        method,
        amount,
        receivedAt: NOW,
        reference: method === "WAVE" ? `T${paymentSeq}${randomBytes(3).toString("hex")}` : null,
        cashSessionId: sessionId,
        receivedById: cashier.membershipId,
      },
    });
  }

  beforeAll(async () => {
    setReceivablesClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage Caisse A", onboardingCompletedAt: NOW },
    });
    const orgB = await adminDb.organization.create({
      data: { name: "Garage Caisse B", onboardingCompletedAt: NOW },
    });
    orgIds.push(orgA.id, orgB.id);
    siteA = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" },
    });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    owner = (await member(orgA.id, "OWNER")).caller;
    manager = (await member(orgA.id, "MANAGER")).caller;
    cashier = await member(orgA.id, "CASHIER", "Awa Koné");
    advisor = (await member(orgA.id, "ADVISOR")).caller;
    callerB = (await member(orgB.id, "OWNER")).caller;
    const session = await cashier.caller.cash.open({ openingFloat: 20_000 });
    sessionId = session.id;
    await cashPayment(100_000);
    await cashPayment(85_000, "WAVE");
  });

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await adminDb.attachment.deleteMany({ where });
    await adminDb.payment.deleteMany({ where });
    await adminDb.cashDrop.deleteMany({ where });
    await adminDb.expense.deleteMany({ where });
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

  it("RG-M08-30 : dépense au-delà du seuil en attente, notifiée, sans effet sur l'espèce attendue", async () => {
    const pending = await cashier.caller.cash.expense({
      sessionId,
      category: "Transport",
      amount: 40_000,
      description: "Remorquage client",
    });
    expect(pending.status).toBe("PENDING");
    const current = (await cashier.caller.cash.current({})).session!;
    // 20 000 + 100 000 espèces ; la dépense en attente ne sort pas encore.
    expect(current.expectedCash).toBe(120_000);
    expect(current.pendingExpensesCount).toBe(1);
    expect(current.pendingExpensesTotal).toBe(40_000);
    expect(current.byMethod).toEqual({ CASH: 100_000, WAVE: 85_000 });
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, type: "cash.expense_pending" },
      }),
    ).toBe(2); // OWNER + MANAGER

    // Le caissier ne décide pas ; le refus exige un motif.
    await expect(
      cashier.caller.cash.decideExpense({ id: pending.id, decision: "approve" }),
    ).rejects.toThrow(/Permission manquante/);
    await expect(
      manager.cash.decideExpense({ id: pending.id, decision: "reject" }),
    ).rejects.toThrow(/motif du refus/);

    await manager.cash.decideExpense({ id: pending.id, decision: "approve", comment: "OK" });
    const after = (await cashier.caller.cash.current({})).session!;
    expect(after.expectedCash).toBe(80_000);
    expect(after.expenses[0]).toMatchObject({
      status: "APPROVED",
      approvedByName: expect.any(String),
    });
    await expect(
      manager.cash.decideExpense({ id: pending.id, decision: "reject", comment: "Erreur" }),
    ).rejects.toThrow(/déjà validée/);
    // Le caissier est prévenu de la décision.
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, type: "cash.expense_approved" },
      }),
    ).toBe(1);
  });

  it("refuse de valider une dépense qui dépasse les espèces en caisse", async () => {
    const tooBig = await cashier.caller.cash.expense({
      sessionId,
      category: "Divers",
      amount: 90_000,
      description: "Achat outillage",
    });
    await expect(
      manager.cash.decideExpense({ id: tooBig.id, decision: "approve" }),
    ).rejects.toThrow(/Espèces insuffisantes/);
    await manager.cash.decideExpense({
      id: tooBig.id,
      decision: "reject",
      comment: "Passer par un bon de commande",
    });
  });

  it("liste des dépenses : filtres, totaux par catégorie, compteur d'attente", async () => {
    await cashier.caller.cash.expense({
      sessionId,
      category: "Carburant",
      amount: 5_000,
      description: "Essai routier",
    });
    const approved = await manager.cash.expenses({});
    expect(approved.totalStatus).toBe("APPROVED");
    expect(approved.total).toBe(45_000);
    expect(approved.byCategory).toEqual([
      { category: "Transport", amount: 40_000, count: 1 },
      { category: "Carburant", amount: 5_000, count: 1 },
    ]);
    expect(approved.items).toHaveLength(3); // toutes, tous statuts confondus
    const rejected = await manager.cash.expenses({ status: "REJECTED" });
    expect(rejected.items).toHaveLength(1);
    expect(rejected.items[0]).toMatchObject({
      status: "REJECTED",
      decisionComment: "Passer par un bon de commande",
    });
    expect(rejected.pendingCount).toBe(0);
    const outOfPeriod = await manager.cash.expenses({ from: "2026-10-22", to: "2026-10-31" });
    expect(outOfPeriod.items).toHaveLength(0);
    const inPeriod = await manager.cash.expenses({ from: "2026-10-21", to: "2026-10-21" });
    expect(inPeriod.items).toHaveLength(3);
  });

  it("justificatif de dépense : envoi puis lien de lecture", async () => {
    const list = await manager.cash.expenses({ category: "Carburant" });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    const uploaded = await cashier.caller.cash.uploadExpenseReceipt({
      expenseId: list.items[0]!.id,
      mimeType: "image/png",
      dataBase64: png.toString("base64"),
    });
    expect(uploaded.url).toMatch(/^\/api\/attachments\//);
    const again = await manager.cash.expenses({ category: "Carburant" });
    expect(again.items[0]!.receiptUrl).toBe(uploaded.url);
  });

  it("clôture : instantané par mode de paiement, détail et filtres de l'historique", async () => {
    await cashier.caller.cash.drop({
      sessionId,
      amount: 30_000,
      destination: "bank",
      reference: "BV-1",
    });
    // 20 000 + 100 000 − 45 000 − 30 000 = 45 000 attendus ; 44 500 comptés.
    const closed = await cashier.caller.cash.close({
      id: sessionId,
      countedCash: 44_500,
      notes: "Pièce de 500 manquante",
    });
    expect(closed.difference).toBe(-500);
    expect(closed.closingSummary).toMatchObject({
      openingFloat: 20_000,
      byMethod: { CASH: 100_000, WAVE: 85_000 },
      totalReceived: 185_000,
      expensesTotal: 45_000,
      dropsTotal: 30_000,
      expectedCash: 45_000,
      countedCash: 44_500,
      difference: -500,
      counts: { payments: 2, expenses: 2, drops: 1, refunds: 0 },
    });

    const detail = await manager.cash.session({ id: sessionId });
    expect(detail.closing?.byMethod).toEqual({ CASH: 100_000, WAVE: 85_000 });
    expect(detail.openedByName).toBe("Awa Koné");
    expect(detail.summary.expenses).toHaveLength(3);

    const toReview = await owner.cash.sessions({ status: "to_review" });
    expect(toReview.items.map((s) => s.id)).toEqual([sessionId]);
    expect(toReview.toReview).toBe(1);
    expect(toReview.items[0]!.totalReceived).toBe(185_000);
    expect(toReview.byCashier).toEqual([
      expect.objectContaining({ cashierName: "Awa Koné", sessions: 1, net: -500, absolute: 500 }),
    ]);
    expect(toReview.cashiers).toEqual([expect.objectContaining({ name: "Awa Koné" })]);
    expect((await owner.cash.sessions({ status: "open" })).items).toHaveLength(0);
    expect((await owner.cash.sessions({ from: "2026-10-22" })).items).toHaveLength(0);

    await owner.cash.review({ id: sessionId, comment: "Écart accepté" });
    const reviewed = await owner.cash.sessions({ status: "reviewed" });
    expect(reviewed.items[0]).toMatchObject({ id: sessionId, reviewedBy: expect.any(String) });
    expect((await owner.cash.sessions({ status: "to_review" })).toReview).toBe(0);

    // Session clôturée : plus de justificatif ni de décision.
    const expenses = await manager.cash.expenses({ category: "Carburant" });
    await expect(
      cashier.caller.cash.uploadExpenseReceipt({
        expenseId: expenses.items[0]!.id,
        mimeType: "image/png",
        dataBase64: "iVBORw0KGgo=",
      }),
    ).rejects.toThrow(/clôturée/);
  });

  it("réglages de caisse : lecture, mise à jour par le propriétaire, validations", async () => {
    const before = await manager.cash.settings();
    expect(before.expenseApproval).toBe(25_000);
    await expect(
      manager.cash.updateSettings({ ...before, expenseApproval: 50_000 }),
    ).rejects.toThrow(/Permission manquante/);
    await expect(
      owner.cash.updateSettings({ ...before, expenseCategories: ["Carburant", "carburant"] }),
    ).rejects.toThrow(/même nom/);
    const saved = await owner.cash.updateSettings({
      varianceAlert: 2_000,
      expenseApproval: 50_000,
      oneSessionPerSite: true,
      expenseCategories: ["Carburant", "Transport", "Eau et repas"],
    });
    expect(saved.expenseCategories).toContain("Eau et repas");
    const current = await cashier.caller.cash.current({});
    expect(current.expenseApproval).toBe(50_000);
    expect(current.expenseCategories).toEqual(["Carburant", "Transport", "Eau et repas"]);
    await expect(advisor.cash.settings()).resolves.toBeTruthy();
  });

  it("isolation multi-locataire : une autre organisation ne voit ni ne décide rien", async () => {
    const list = await manager.cash.expenses({});
    expect((await callerB.cash.expenses({})).items).toHaveLength(0);
    expect((await callerB.cash.sessions({})).items).toHaveLength(0);
    await expect(callerB.cash.session({ id: sessionId })).rejects.toThrow(/introuvable/);
    await expect(
      callerB.cash.decideExpense({ id: list.items[0]!.id, decision: "approve" }),
    ).rejects.toThrow(/introuvable/);
  });
});
