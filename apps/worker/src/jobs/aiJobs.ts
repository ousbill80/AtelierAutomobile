// M17 §9 — tâches IA :
// - `ai.anomalies` (06:00) : détection déterministe (RG-M17-22) → alerte au gérant (OWNER),
//   dédoublonnée par objet, visible dans les alertes du tableau de bord (`alert.anomaly.*`).
// - `ai.suggestions_expire` (horaire) : suggestions en attente depuis 48 h → EXPIRED (§5).
// - `ai.learn_reminder_timing` (dimanche 03:00) : meilleur créneau/canal par client (RG-M17-16).
// - `ai.purge_outputs` (quotidienne) : sorties des AiInteraction de plus de 180 j vidées,
//   métadonnées conservées (RG-M17-06).
import {
  ANOMALIES_PAGE,
  anomalyDedupeKey,
  detectBillingGapAnomalies,
  detectCashGapAnomalies,
  detectDiscountAnomalies,
  detectPriceBelowCostAnomalies,
  detectStockShrinkAnomalies,
  detectVoidSpikeAnomalies,
  learnSendPreference,
  type Anomaly,
  type OutboundStat,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { logger } from "../logger";

type TenantDb = ReturnType<typeof db.forTenant>;

const DAY_MS = 24 * 60 * 60 * 1000;
const OUTPUT_RETENTION_DAYS = 180;

async function memberNames(tx: TenantDb, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.membership.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.user.name ?? "—"]));
}

/** Charge les données des 90 derniers jours et applique les détecteurs de `core`. */
export async function detectAnomaliesForOrganization(
  organizationId: string,
  now: Date,
): Promise<Anomaly[]> {
  const tx = db.forTenant({ organizationId });
  const since90 = new Date(now.getTime() - 90 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const yesterday = new Date(now.getTime() - DAY_MS);

  const invoices = await tx.invoice.findMany({
    where: {
      type: "INVOICE",
      issuedAt: { gte: since90 },
      status: { notIn: ["DRAFT", "VOID"] },
    },
    select: {
      id: true,
      number: true,
      createdById: true,
      issuedAt: true,
      subtotal: true,
      discountTotal: true,
      repairOrderId: true,
      lines: {
        select: {
          type: true,
          productId: true,
          description: true,
          quantity: true,
          unitPrice: true,
          discountRate: true,
          costAmount: true,
        },
      },
    },
  });
  const names = await memberNames(
    tx,
    invoices.map((i) => i.createdById).filter((id): id is string => !!id),
  );
  const anomalies: Anomaly[] = [];

  anomalies.push(
    ...detectDiscountAnomalies(
      invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        advisorId: inv.createdById,
        advisorName: (inv.createdById && names.get(inv.createdById)) || "—",
        issuedAt: inv.issuedAt!,
        documentRate:
          inv.subtotal + inv.discountTotal > 0
            ? (100 * inv.discountTotal) / (inv.subtotal + inv.discountTotal)
            : 0,
        maxLineRate: Math.max(0, ...inv.lines.map((l) => l.discountRate)),
      })),
      yesterday,
    ),
  );

  const recent = invoices.filter((i) => i.issuedAt! >= yesterday);
  anomalies.push(
    ...detectPriceBelowCostAnomalies(
      recent.flatMap((inv) =>
        inv.lines
          .filter((l) => l.type === "PART" && l.quantity > 0 && l.costAmount > 0)
          .map((l) => ({
            invoiceId: inv.id,
            invoiceNumber: inv.number,
            description: l.description,
            netUnitPrice: (l.unitPrice * (100 - l.discountRate)) / 100,
            averageCost: Math.round(l.costAmount / l.quantity),
          })),
      ),
    ),
  );

  // Pièces sorties vers l'OR mais absentes de sa facture ; temps pointé vs temps vendu.
  const billed = recent.filter((i) => i.repairOrderId);
  if (billed.length) {
    const roIds = billed.map((i) => i.repairOrderId!);
    const [moves, entries, orders] = await Promise.all([
      tx.stockMovement.findMany({
        where: { repairOrderId: { in: roIds }, type: { in: ["ISSUE_TO_RO", "RETURN_FROM_RO"] } },
        select: {
          repairOrderId: true,
          productId: true,
          quantity: true,
          product: { select: { name: true } },
        },
      }),
      tx.timeEntry.findMany({
        where: { repairOrderId: { in: roIds }, kind: "WORK", endedAt: { not: null } },
        select: { repairOrderId: true, startedAt: true, endedAt: true, pauseMinutes: true },
      }),
      tx.repairOrder.findMany({
        where: { id: { in: roIds } },
        select: { id: true, number: true },
      }),
    ]);
    anomalies.push(
      ...detectBillingGapAnomalies(
        billed.map((inv) => {
          const net = new Map<string, { name: string; quantity: number }>();
          for (const m of moves.filter((m) => m.repairOrderId === inv.repairOrderId)) {
            const current = net.get(m.productId) ?? { name: m.product.name, quantity: 0 };
            // Les sorties sont négatives, les retours positifs : quantité nette sortie = −Σ.
            net.set(m.productId, { ...current, quantity: current.quantity - m.quantity });
          }
          const worked = entries
            .filter((e) => e.repairOrderId === inv.repairOrderId)
            .reduce(
              (s, e) =>
                s +
                (e.endedAt!.getTime() - e.startedAt.getTime()) / 3_600_000 -
                e.pauseMinutes / 60,
              0,
            );
          return {
            repairOrderId: inv.repairOrderId!,
            repairOrderNumber:
              orders.find((o) => o.id === inv.repairOrderId)?.number ?? inv.repairOrderId!,
            invoiceId: inv.id,
            invoiceNumber: inv.number,
            issued: [...net.entries()].map(([productId, v]) => ({
              productId,
              productName: v.name,
              quantity: v.quantity,
            })),
            billedProductIds: inv.lines.map((l) => l.productId).filter((id): id is string => !!id),
            workedHours: Math.max(0, worked),
            soldHours: inv.lines
              .filter((l) => l.type === "LABOR")
              .reduce((s, l) => s + l.quantity, 0),
          };
        }),
      ),
    );
  }

  const sessions = await tx.cashSession.findMany({
    where: { closedAt: { gte: since30 }, difference: { not: null }, closedById: { not: null } },
    select: { id: true, closedById: true, closedAt: true, difference: true },
  });
  const cashierNames = await memberNames(
    tx,
    sessions.map((s) => s.closedById!),
  );
  anomalies.push(
    ...detectCashGapAnomalies(
      sessions.map((s) => ({
        id: s.id,
        cashierId: s.closedById!,
        cashierName: cashierNames.get(s.closedById!) ?? "—",
        closedAt: s.closedAt!,
        difference: s.difference!,
      })),
      now,
    ),
  );

  const adjustments = await tx.stockMovement.findMany({
    where: {
      createdAt: { gte: since30 },
      type: { in: ["ADJUSTMENT", "COUNT_CORRECTION"] },
      quantity: { lt: 0 },
    },
    select: {
      productId: true,
      type: true,
      quantity: true,
      unitCost: true,
      createdAt: true,
      product: { select: { name: true, averageCost: true } },
    },
  });
  anomalies.push(
    ...detectStockShrinkAnomalies(
      adjustments.map((m) => ({
        productId: m.productId,
        productName: m.product.name,
        type: m.type as "ADJUSTMENT" | "COUNT_CORRECTION",
        quantity: m.quantity,
        unitCost: m.unitCost ?? m.product.averageCost,
        createdAt: m.createdAt,
      })),
      now,
    ),
  );

  const creditNotes = await tx.invoice.findMany({
    where: { type: "CREDIT_NOTE", createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
    select: { createdById: true, createdAt: true },
  });
  const voided = await tx.invoice.findMany({
    where: { voidedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
    select: { createdById: true, voidedAt: true },
  });
  const voidRows = [
    ...creditNotes.map((c) => ({ userId: c.createdById, at: c.createdAt })),
    ...voided.map((v) => ({ userId: v.createdById, at: v.voidedAt! })),
  ].filter((r): r is { userId: string; at: Date } => !!r.userId);
  const voidNames = await memberNames(
    tx,
    voidRows.map((r) => r.userId),
  );
  anomalies.push(
    ...detectVoidSpikeAnomalies(
      voidRows.map((r) => ({ ...r, userName: voidNames.get(r.userId) ?? "—" })),
      now,
    ),
  );
  return anomalies;
}

/** Une alerte par anomalie et par OWNER actif (dédoublonnée), événement `ai.anomaly_detected`. */
export async function notifyAnomalies(
  organizationId: string,
  anomalies: Anomaly[],
  now: Date,
): Promise<number> {
  if (!anomalies.length) return 0;
  const tx = db.forTenant({ organizationId });
  const owners = await tx.membership.findMany({
    where: { isActive: true, role: "OWNER" },
    select: { id: true },
  });
  let created = 0;
  for (const anomaly of anomalies) {
    const dedupeKey = anomalyDedupeKey(anomaly, now);
    let fresh = false;
    for (const owner of owners) {
      const existing = await tx.notification.findFirst({
        where: { membershipId: owner.id, dedupeKey },
      });
      if (existing) continue;
      await tx.notification.create({
        data: {
          organizationId,
          membershipId: owner.id,
          type: `alert.${anomaly.code}`,
          severity: "warning",
          title: anomaly.title,
          body: anomaly.body,
          link: ANOMALIES_PAGE,
          dedupeKey,
        },
      });
      fresh = true;
      created += 1;
    }
    if (fresh) {
      await tx.domainEvent.create({
        data: {
          organizationId,
          type: "ai.anomaly_detected",
          payload: { code: anomaly.code, objectId: anomaly.objectId, dedupeKey },
        },
      });
    }
  }
  return created;
}

export async function processAiAnomaliesJob(now = new Date()): Promise<void> {
  const orgs = await adminDb.organization.findMany({
    where: { onboardingCompletedAt: { not: null } },
    select: { id: true },
  });
  for (const org of orgs) {
    try {
      const anomalies = await detectAnomaliesForOrganization(org.id, now);
      const created = await notifyAnomalies(org.id, anomalies, now);
      if (created)
        logger.info({ organizationId: org.id, created }, "ai.anomalies : alertes créées");
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        "ai.anomalies : échec pour une organisation",
      );
    }
  }
}

/** §5 — suggestions PENDING dont l'échéance (48 h) est passée → EXPIRED. */
export async function processAiSuggestionsExpireJob(now = new Date()): Promise<number> {
  const result = await adminDb.aiSuggestion.updateMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

/** RG-M17-06 — sorties de plus de 180 jours vidées (métadonnées conservées). */
export async function processAiPurgeOutputsJob(now = new Date()): Promise<number> {
  const result = await adminDb.aiInteraction.updateMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - OUTPUT_RETENTION_DAYS * DAY_MS) },
      NOT: { output: { equals: {} } },
    },
    data: { output: {} },
  });
  return result.count;
}

const POSITIVE_OUTCOMES = new Set(["APPOINTMENT_BOOKED", "PAID", "PARTIALLY_PAID", "PROMISED"]);

/**
 * RG-M17-16 — `ai.learn_reminder_timing` (hebdomadaire) : par client, créneau de 2 h et canal
 * préférés appris des messages sortants des 12 derniers mois (lecture ou résultat positif de
 * la relance). Renseigne `Customer.bestSendHour` / `bestChannel` (jamais `preferredChannel`,
 * réservé au choix manuel).
 */
export async function learnReminderTimingForOrganization(
  organizationId: string,
  timeZone: string,
  now: Date,
): Promise<number> {
  const tx = db.forTenant({ organizationId });
  const messages = await tx.message.findMany({
    where: {
      direction: "OUTBOUND",
      customerId: { not: null },
      sentAt: { gte: new Date(now.getTime() - 365 * DAY_MS) },
    },
    select: {
      customerId: true,
      channel: true,
      sentAt: true,
      readAt: true,
      status: true,
      reminder: { select: { outcome: true } },
    },
  });
  const byCustomer = new Map<string, OutboundStat[]>();
  for (const m of messages) {
    const stat: OutboundStat = {
      channel: m.channel as OutboundStat["channel"],
      sentAt: m.sentAt!,
      positive:
        m.readAt !== null ||
        m.status === "READ" ||
        (m.reminder?.outcome ? POSITIVE_OUTCOMES.has(m.reminder.outcome) : false),
    };
    byCustomer.set(m.customerId!, [...(byCustomer.get(m.customerId!) ?? []), stat]);
  }
  let updated = 0;
  for (const [customerId, stats] of byCustomer) {
    const preference = learnSendPreference(stats, timeZone, now);
    const current = await tx.customer.findFirst({
      where: { id: customerId },
      select: { bestSendHour: true, bestChannel: true },
    });
    if (
      current &&
      (current.bestSendHour !== preference.bestHour ||
        current.bestChannel !== preference.bestChannel)
    ) {
      await tx.customer.update({
        where: { id: customerId },
        data: { bestSendHour: preference.bestHour, bestChannel: preference.bestChannel },
      });
      updated += 1;
    }
  }
  return updated;
}

export async function processAiLearnReminderTimingJob(now = new Date()): Promise<void> {
  const orgs = await adminDb.organization.findMany({
    where: { onboardingCompletedAt: { not: null } },
    select: { id: true, timezone: true },
  });
  for (const org of orgs) {
    try {
      await learnReminderTimingForOrganization(org.id, org.timezone, now);
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        "ai.learn_reminder_timing : échec pour une organisation",
      );
    }
  }
}
