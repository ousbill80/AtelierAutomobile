// M09 — orchestration partagée par le routeur `collections` (apps/web) et le job
// `receivables.age` (apps/worker) : recalcul des soldes d'un client, passage `OVERDUE`,
// ouverture / rattachement / fermeture / réouverture du dossier (RG-M09-03).
// Toute la logique de décision vit dans `@atelieros/core` (fonctions pures testées).
import {
  attributePayment,
  customerExposure,
  daysOverdue,
  decideCaseAction,
  evaluatePromise,
  OPEN_INVOICE_STATUSES,
  riskScore,
  statusAfterResume,
  type AgingInvoice,
  type CollectionStatusLike,
  type DocumentSequenceKey,
  type SequenceStore,
} from "@atelieros/core";
import type { Prisma } from "@prisma/client";
import type { ScopedTenantClient } from "./tenant";

export interface CollectionSettings {
  minAmount: number;
  attributionDays: number;
  blockAfterDays: number;
  writeOffMinDays: number;
  graceDays: number;
  reopenWithinDays: number;
}

export const DEFAULT_COLLECTION_SETTINGS: CollectionSettings = {
  minAmount: 2_000,
  attributionDays: 7,
  blockAfterDays: 60,
  writeOffMinDays: 90,
  graceDays: 0,
  reopenWithinDays: 30,
};

/** `Organization.settings.collections` fusionné avec les défauts de M09 §6. */
export function collectionSettingsFrom(settings: unknown): CollectionSettings {
  const raw =
    settings && typeof settings === "object"
      ? ((settings as Record<string, unknown>).collections as Record<string, unknown> | undefined)
      : undefined;
  const out = { ...DEFAULT_COLLECTION_SETTINGS };
  if (raw) {
    for (const key of Object.keys(out) as (keyof CollectionSettings)[]) {
      const v = raw[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    }
  }
  return out;
}

type Tx = ScopedTenantClient;

const ACTIVE: CollectionStatusLike[] = ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"];

async function emit(
  tx: Tx,
  organizationId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  await tx.domainEvent.create({
    data: { organizationId, type, payload: payload as Prisma.InputJsonValue },
  });
}

export interface SyncResult {
  caseId: string | null;
  totalDue: number;
  overdueDue: number;
  maxDaysOverdue: number;
}

/**
 * Recalcule la situation d'un client à la date `today` (minuit UTC du jour local) :
 * idempotent, à appeler après chaque paiement / litige / perte et chaque nuit.
 */
export async function syncCustomerReceivables(
  tx: Tx,
  input: {
    organizationId: string;
    customerId: string;
    today: Date;
    now: Date;
    settings: CollectionSettings;
  },
): Promise<SyncResult> {
  const { organizationId, customerId, today, now, settings } = input;
  const invoices = await tx.invoice.findMany({
    where: {
      customerId,
      billTo: "CUSTOMER",
      type: { in: ["INVOICE", "DEPOSIT"] },
      status: { in: [...OPEN_INVOICE_STATUSES] },
    },
    select: {
      id: true,
      customerId: true,
      type: true,
      status: true,
      billTo: true,
      balance: true,
      dueDate: true,
      collectionCaseId: true,
    },
  });

  // §5.3 : ISSUED / PARTIALLY_PAID → OVERDUE dès 1 jour de retard.
  for (const invoice of invoices) {
    if (
      (invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") &&
      invoice.balance > 0 &&
      daysOverdue(invoice.dueDate, today) >= 1
    ) {
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: "OVERDUE" } });
      invoice.status = "OVERDUE";
    }
  }

  const exposure = customerExposure(invoices as AgingInvoice[], today);
  const [activeCase, lastClosedCase] = await Promise.all([
    tx.collectionCase.findFirst({ where: { customerId, status: { in: ACTIVE } } }),
    tx.collectionCase.findFirst({
      where: { customerId, status: { in: ["CLOSED_PAID", "CLOSED_WRITTEN_OFF"] } },
      orderBy: { closedAt: "desc" },
    }),
  ]);
  const writtenOffLeft =
    exposure.totalDue === 0 &&
    (await tx.invoice.count({
      where: { customerId, status: "WRITTEN_OFF", collectionCaseId: activeCase?.id ?? "__none__" },
    })) > 0;

  const decision = decideCaseAction({
    activeCase: activeCase
      ? { id: activeCase.id, status: activeCase.status, closedAt: activeCase.closedAt }
      : null,
    lastClosedCase: lastClosedCase
      ? { id: lastClosedCase.id, status: lastClosedCase.status, closedAt: lastClosedCase.closedAt }
      : null,
    // Un litige ne ferme pas le dossier : le montant contesté reste dû (RG-M09-08).
    overdueDue: exposure.overdueDue + exposure.disputedDue,
    onlyWrittenOffLeft: writtenOffLeft,
    minAmount: settings.minAmount,
    reopenWithinDays: settings.reopenWithinDays,
    today,
  });

  const totals = {
    totalDue: exposure.totalDue,
    overdueDue: exposure.overdueDue,
    oldestDueDate: exposure.oldestDueDate,
    maxDaysOverdue: exposure.maxDaysOverdue,
  };
  let caseId: string | null = activeCase?.id ?? null;

  switch (decision.action) {
    case "open": {
      const created = await tx.collectionCase.create({
        data: {
          organizationId,
          customerId,
          status: "OPEN",
          anchorDate: exposure.oldestDueDate,
          ...totals,
        },
      });
      caseId = created.id;
      await emit(tx, organizationId, "collection.opened", { caseId, customerId });
      break;
    }
    case "reopen": {
      await tx.collectionCase.update({
        where: { id: decision.caseId },
        data: { status: "OPEN", closedAt: null, closeReason: null, ...totals },
      });
      caseId = decision.caseId;
      await emit(tx, organizationId, "collection.reopened", { caseId, customerId });
      break;
    }
    case "update": {
      const kase = activeCase!;
      const data: Prisma.CollectionCaseUpdateInput = { ...totals };
      // RG-M09-07 : reprise automatique des pauses échues.
      if (
        kase.status === "PAUSED" &&
        kase.pausedUntil &&
        kase.pausedUntil.getTime() <= today.getTime()
      ) {
        data.status = statusAfterResume({
          previousStatus: kase.previousStatus,
          escalatedAt: kase.escalatedAt,
        });
        data.pausedUntil = null;
        data.previousStatus = null;
        await emit(tx, organizationId, "collection.resumed", { caseId: kase.id, customerId });
      }
      await tx.collectionCase.update({ where: { id: kase.id }, data });
      break;
    }
    case "close": {
      await tx.collectionCase.update({
        where: { id: decision.caseId },
        data: {
          ...totals,
          status: decision.status,
          closedAt: now,
          closeReason: decision.status === "CLOSED_PAID" ? "Soldé" : "Passé en perte",
          pausedUntil: null,
        },
      });
      // RG-M09-10 : `creditHold` levé automatiquement à CLOSED_PAID.
      if (decision.status === "CLOSED_PAID") {
        await tx.customer.update({
          where: { id: customerId },
          data: { creditHold: false, creditHoldReason: null },
        });
      }
      await emit(tx, organizationId, "collection.closed", {
        caseId: decision.caseId,
        customerId,
        status: decision.status,
      });
      break;
    }
    case "none":
      break;
  }

  if (caseId && decision.action !== "close") {
    const toLink = invoices
      .filter((i) => i.collectionCaseId !== caseId && i.status !== "ISSUED")
      .map((i) => i.id);
    if (toLink.length > 0) {
      await tx.invoice.updateMany({
        where: { id: { in: toLink } },
        data: { collectionCaseId: caseId },
      });
    }
  }

  await updateRiskScore(tx, { customerId, caseId, today, exposure });
  return { caseId: decision.action === "close" ? null : caseId, ...totals };
}

async function updateRiskScore(
  tx: Tx,
  input: {
    customerId: string;
    caseId: string | null;
    today: Date;
    exposure: { overdueDue: number; maxDaysOverdue: number };
  },
) {
  const since = new Date(input.today.getTime() - 365 * 86_400_000);
  const [recent, kase] = await Promise.all([
    tx.invoice.findMany({
      where: { customerId: input.customerId, type: "INVOICE", issuedAt: { gte: since } },
      select: { total: true, status: true, dueDate: true },
    }),
    input.caseId ? tx.collectionCase.findFirst({ where: { id: input.caseId } }) : null,
  ]);
  const billed = recent.reduce((s, i) => s + i.total, 0);
  // Approximation documentée : « à temps » = soldée ou pas en retard de plus de 7 jours.
  const onTime = recent.filter(
    (i) => i.status === "PAID" || daysOverdue(i.dueDate, input.today) <= 7,
  ).length;
  const r = riskScore({
    maxDaysOverdue: input.exposure.maxDaysOverdue,
    overdueDue: input.exposure.overdueDue,
    avgMonthlyBilled12m: Math.round(billed / 12),
    brokenPromises12m: kase?.brokenPromiseCount ?? 0,
    invoices12m: recent.length,
    onTimeRatio12m: recent.length ? onTime / recent.length : 1,
    unreachable: (kase?.unreachableCount ?? 0) >= 3,
    openDispute: kase?.status === "DISPUTED",
  });
  await tx.customer.update({
    where: { id: input.customerId },
    data: { riskScore: r.score, riskComponents: r.components as unknown as Prisma.InputJsonValue },
  });
}

/**
 * RG-M09-06 : évalue les promesses `PENDING` d'un dossier (job de nuit et `payment.received`).
 * Renvoie les promesses passées à un état terminal.
 */
export async function evaluateCasePromises(
  tx: Tx,
  input: { organizationId: string; caseId: string; today: Date; now: Date; graceDays: number },
): Promise<{ id: string; status: string }[]> {
  const promises = await tx.paymentPromise.findMany({
    where: { collectionCaseId: input.caseId, status: "PENDING" },
    orderBy: { promisedDate: "asc" },
  });
  if (promises.length === 0) return [];
  const kase = await tx.collectionCase.findFirst({ where: { id: input.caseId } });
  if (!kase) return [];
  const changed: { id: string; status: string }[] = [];
  for (const promise of promises) {
    const allocations = await tx.paymentAllocation.findMany({
      where: {
        invoice: { collectionCaseId: input.caseId },
        payment: { receivedAt: { gte: promise.createdAt } },
      },
      select: { amount: true },
    });
    // Un paiement ne compte qu'une fois sur un échéancier : on retire ce qui est déjà imputé
    // aux promesses évaluées plus tôt.
    const alreadyCounted = await tx.paymentPromise.aggregate({
      where: {
        collectionCaseId: input.caseId,
        status: { in: ["KEPT", "PARTIALLY_KEPT"] },
        createdAt: { lte: promise.createdAt },
      },
      _sum: { paidAmount: true },
    });
    const paid = Math.max(
      0,
      allocations.reduce((s, a) => s + a.amount, 0) - (alreadyCounted._sum.paidAmount ?? 0),
    );
    const status = evaluatePromise({
      amount: promise.amount,
      promisedDate: promise.promisedDate,
      paid,
      today: input.today,
      graceDays: input.graceDays,
    });
    if (status === "PENDING") continue;
    await tx.paymentPromise.update({
      where: { id: promise.id },
      data: { status, paidAmount: Math.min(paid, promise.amount), evaluatedAt: input.now },
    });
    changed.push({ id: promise.id, status });
  }
  if (changed.length === 0) return changed;
  const stillPending = await tx.paymentPromise.count({
    where: { collectionCaseId: input.caseId, status: "PENDING" },
  });
  const broken = changed.filter((c) => c.status !== "KEPT").length;
  const data: Prisma.CollectionCaseUpdateInput = {};
  if (broken > 0) data.brokenPromiseCount = kase.brokenPromiseCount + broken;
  if (stillPending === 0 && kase.status === "PROMISED") {
    data.status = statusAfterResume({
      previousStatus: kase.previousStatus,
      escalatedAt: kase.escalatedAt,
    });
    data.pausedUntil = null;
    data.previousStatus = null;
  }
  // RG-M09-06 : 2 promesses rompues → crédit suspendu.
  if (kase.brokenPromiseCount + broken >= 2) {
    await tx.customer.update({
      where: { id: kase.customerId },
      data: { creditHold: true, creditHoldReason: "2 promesses de paiement rompues" },
    });
  }
  await tx.collectionCase.update({ where: { id: input.caseId }, data });
  for (const c of changed) {
    await emit(
      tx,
      input.organizationId,
      c.status === "KEPT" ? "collection.promise_kept" : "collection.promise_broken",
      {
        caseId: input.caseId,
        customerId: kase.customerId,
        promiseId: c.id,
        status: c.status,
      },
    );
  }
  return changed;
}

/** RG-M09-14 : crée la `PaymentAttribution` de chaque affectation d'un paiement. */
export async function attributeAllocations(
  tx: Tx,
  input: {
    organizationId: string;
    customerId: string;
    receivedAt: Date;
    attributionDays: number;
    allocations: { id: string; amount: number }[];
  },
): Promise<void> {
  const since = new Date(input.receivedAt.getTime() - input.attributionDays * 86_400_000);
  const [reminders, calls] = await Promise.all([
    tx.reminder.findMany({
      where: {
        customerId: input.customerId,
        type: "RECEIVABLE",
        sentAt: { gte: since, lte: input.receivedAt },
      },
      select: { id: true, sentAt: true },
    }),
    tx.collectionNote.findMany({
      where: {
        collectionCase: { customerId: input.customerId },
        type: "call",
        callOutcome: "REACHED",
        createdAt: { gte: since, lte: input.receivedAt },
      },
      select: { id: true, createdAt: true },
    }),
  ]);
  const result = attributePayment({
    receivedAt: input.receivedAt,
    reminders: reminders.filter((r) => r.sentAt).map((r) => ({ id: r.id, at: r.sentAt! })),
    calls: calls.map((c) => ({ id: c.id, at: c.createdAt })),
    attributionDays: input.attributionDays,
  });
  for (const allocation of input.allocations) {
    await tx.paymentAttribution.create({
      data: {
        organizationId: input.organizationId,
        paymentAllocationId: allocation.id,
        source: result.source,
        reminderId: result.source === "reminder" ? result.reminderId : null,
        collectionNoteId: result.source === "call" ? result.collectionNoteId : null,
        amount: allocation.amount,
      },
    });
  }
}

/** `SequenceStore` sans trou sur `DocumentSequence`, dans la transaction de l'appelant. */
export function tenantSequenceStore(tx: Tx): SequenceStore {
  return {
    async getAndIncrement(key: DocumentSequenceKey): Promise<number> {
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await tx.documentSequence.findFirst({
          where: { siteId: key.siteId, docType: key.docType, year: key.year },
        });
        if (!existing) {
          await tx.documentSequence.create({
            data: {
              organizationId: key.organizationId,
              siteId: key.siteId,
              docType: key.docType,
              year: key.year,
              lastValue: 1,
            },
          });
          return 1;
        }
        const { count } = await tx.documentSequence.updateMany({
          where: { id: existing.id, lastValue: existing.lastValue },
          data: { lastValue: existing.lastValue + 1 },
        });
        if (count === 1) return existing.lastValue + 1;
      }
      throw new Error("Numérotation : conflit persistant sur DocumentSequence.");
    },
  };
}
