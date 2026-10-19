// M04 §9 — notifications internes de suivi des OR (jamais d'envoi au client ici : le message
// « véhicule prêt » et son rappel relèvent de M10, règle VEHICLE_READY).
// - late_check : OR dont la promesse est dépassée et le statut antérieur à READY (RG-M04-10)
//   → notification au conseiller et aux chefs d'atelier, une fois par OR et par jour.
// - ready_followup : véhicule prêt depuis `readyReminderAfterDays` jours ouvrés → rappel au
//   conseiller ; frais de gardiennage dus (RG-M04-15) → proposition (jamais automatique).
import {
  addBusinessDays,
  businessDate,
  formatFCFA,
  isLate,
  repairOrderSettingsFrom,
  storageFee,
  type RepairOrderStatus,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { logger } from "../logger";

type TenantDb = ReturnType<typeof db.forTenant>;

const BEFORE_READY: RepairOrderStatus[] = [
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
];

async function notifyOnce(
  tenantDb: TenantDb,
  organizationId: string,
  membershipIds: (string | null)[],
  data: { type: string; title: string; body?: string; link: string; dedupeKey: string },
): Promise<number> {
  let created = 0;
  for (const membershipId of new Set(membershipIds.filter((m): m is string => !!m))) {
    const existing = await tenantDb.notification.findFirst({
      where: { membershipId, dedupeKey: data.dedupeKey },
    });
    if (existing) continue;
    await tenantDb.notification.create({
      data: { organizationId, membershipId, severity: "warning", ...data },
    });
    created += 1;
  }
  return created;
}

async function managers(tenantDb: TenantDb): Promise<string[]> {
  const rows = await tenantDb.membership.findMany({
    where: { isActive: true, role: { in: ["MANAGER", "OWNER"] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function lateCheckForOrganization(organizationId: string, now: Date): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const tenantDb = db.forTenant({ organizationId });
  const orders = await tenantDb.repairOrder.findMany({
    where: { status: { in: BEFORE_READY }, promisedAt: { lt: now }, deletedAt: null },
    select: { id: true, number: true, status: true, promisedAt: true, advisorId: true },
  });
  const day = businessDate(now, org.timezone).toISOString().slice(0, 10);
  const recipients = await managers(tenantDb);
  let created = 0;
  for (const order of orders) {
    if (!isLate({ status: order.status, promisedAt: order.promisedAt }, now)) continue;
    created += await notifyOnce(tenantDb, organizationId, [order.advisorId, ...recipients], {
      type: "repair_order.late",
      title: `OR en retard sur la promesse — ${order.number}`,
      link: `/ordres/${order.id}`,
      dedupeKey: `ro_late:${order.id}:${day}`,
    });
  }
  return created;
}

export async function readyFollowupForOrganization(
  organizationId: string,
  now: Date,
): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, settings: true },
  });
  const settings = repairOrderSettingsFrom(org.settings);
  const tenantDb = db.forTenant({ organizationId });
  const today = businessDate(now, org.timezone);
  const day = today.toISOString().slice(0, 10);
  const orders = await tenantDb.repairOrder.findMany({
    where: { status: "READY", readyAt: { not: null }, deletedAt: null },
    select: { id: true, number: true, readyAt: true, advisorId: true, siteId: true },
  });
  const holidays = (await tenantDb.holiday.findMany({ select: { date: true, siteId: true } })).map(
    (h) => ({ date: h.date, siteId: h.siteId }),
  );
  let created = 0;
  for (const order of orders) {
    const readyOn = businessDate(order.readyAt!, org.timezone);
    const remindFrom = addBusinessDays(
      readyOn,
      Math.max(1, settings.readyReminderAfterDays),
      org.timezone,
      {
        siteId: order.siteId,
        holidays,
      },
    );
    if (today.getTime() >= remindFrom.getTime()) {
      created += await notifyOnce(tenantDb, organizationId, [order.advisorId], {
        type: "repair_order.not_collected",
        title: `Véhicule prêt non récupéré — ${order.number}`,
        link: `/ordres/${order.id}`,
        dedupeKey: `ro_ready:${order.id}:${day}`,
      });
    }
    if (settings.storageFeeEnabled) {
      const fee = storageFee({
        readyOn,
        today,
        afterDays: settings.storageFeeAfterDays,
        perDay: settings.storageFeePerDay,
        holidays: holidays.filter((h) => !h.siteId || h.siteId === order.siteId).map((h) => h.date),
      });
      if (fee) {
        created += await notifyOnce(tenantDb, organizationId, [order.advisorId], {
          type: "repair_order.storage_fee",
          title: `Frais de gardiennage à proposer — ${order.number}`,
          body: `${fee.description} = ${formatFCFA(fee.amount)}`,
          link: `/ordres/${order.id}`,
          dedupeKey: `ro_storage:${order.id}:${day}`,
        });
      }
    }
  }
  return created;
}

async function forEachFullOrganization(
  name: string,
  fn: (organizationId: string, now: Date) => Promise<number>,
): Promise<void> {
  const organizations = await adminDb.organization.findMany({
    where: { operatingMode: "FULL" },
    select: { id: true },
  });
  const now = new Date();
  for (const org of organizations) {
    try {
      await fn(org.id, now);
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        `${name} : échec sur une organisation, passage à la suivante`,
      );
    }
  }
}

export function processRepairOrdersLateCheckJob(): Promise<void> {
  return forEachFullOrganization("repairOrders.late_check", lateCheckForOrganization);
}

export function processRepairOrdersReadyFollowupJob(): Promise<void> {
  return forEachFullOrganization("repairOrders.ready_followup", readyFollowupForOrganization);
}
