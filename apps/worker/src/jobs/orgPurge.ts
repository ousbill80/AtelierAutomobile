// M15 RG-M15-22 — tâche quotidienne `org.purge` : organisations dont la suppression programmée
// est échue (J+30). Les données personnelles sont effacées ou anonymisées ; les factures émises,
// leurs lignes et les paiements sont conservés (OHADA, 10 ans) avec un client anonymisé
// (« Client supprimé #<hash> », téléphone/email nuls). Les clés, jetons et identifiants
// fournisseurs sont révoqués. Aussi : expiration des exports (lien 48 h, archive supprimée).
import {
  anonymizedCustomerName,
  isDueForPurge,
  systemClock,
  type Clock,
  type OrgLifecycleStatus,
} from "@atelieros/core";
import { adminDb, db, Prisma, writeAuditLog } from "@atelieros/db";
import { logger } from "../logger";

export interface PurgeStorage {
  deleteObject(key: string): Promise<void>;
}

export interface OrgPurgeDeps {
  storage?: PurgeStorage;
  clock?: Clock;
}

async function deleteObjects(storage: PurgeStorage | undefined, keys: string[]) {
  if (!storage) return;
  for (const key of keys) {
    try {
      await storage.deleteObject(key);
    } catch (error) {
      logger.warn({ key, error: (error as Error).message }, "org.purge : objet non supprimé");
    }
  }
}

/** Purge d'une organisation (idempotente : relancée sans effet si déjà PURGED). */
export async function purgeOrganization(organizationId: string, deps: OrgPurgeDeps = {}) {
  const clock = deps.clock ?? systemClock;
  const now = clock.now();
  const tx = db.forTenant({ organizationId });

  const customers = await tx.customer.findMany({ select: { id: true } });
  for (const customer of customers) {
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        displayName: anonymizedCustomerName(customer.id),
        firstName: null,
        lastName: null,
        companyName: null,
        civility: null,
        phone: null,
        phone2: null,
        whatsappPhone: null,
        email: null,
        address: null,
        commune: null,
        ncc: null,
        rccm: null,
        notes: null,
        riskFactors: Prisma.DbNull,
        riskComponents: Prisma.DbNull,
        remindersConsent: false,
        marketingConsent: false,
        doNotRemind: true,
        doNotRemindReason: "Compte du garage supprimé",
        anonymizedAt: now,
        deletedAt: now,
      },
    });
  }

  const vehicles = await tx.vehicle.findMany({ select: { id: true } });
  for (const vehicle of vehicles) {
    const anonymous = `ANONYME-${vehicle.id.slice(-8).toUpperCase()}`;
    await tx.vehicle.update({
      where: { id: vehicle.id },
      data: {
        plate: anonymous,
        plateCompact: anonymous,
        vin: null,
        driverName: null,
        driverPhone: null,
        fleetNumber: null,
        insurancePolicyNumber: null,
        notes: null,
        deletedAt: now,
      },
    });
  }

  await tx.customerContact.updateMany({
    data: { name: "Contact supprimé", phone: null, phone2: null, email: null, deletedAt: now },
  });
  await tx.customerNote.deleteMany({});
  await tx.messageStatusEvent.deleteMany({});
  await tx.messageAttempt.deleteMany({});
  await tx.message.updateMany({
    data: {
      to: "",
      from: null,
      subject: null,
      body: "[supprimé]",
      attachments: [],
      errorMessage: null,
    },
  });
  await tx.conversation.updateMany({ data: { externalAddress: "", candidateCustomerIds: [] } });
  await tx.optOut.deleteMany({});
  await tx.reminder.updateMany({
    data: { renderedBody: null, renderedSubject: null, editedContext: Prisma.DbNull },
  });
  await tx.aiAssistantMessage.deleteMany({});
  await tx.aiAssistantThread.deleteMany({});
  await tx.aiInteraction.updateMany({ data: { output: {}, inputRef: null } });
  await tx.notification.deleteMany({});
  await tx.invitation.deleteMany({});
  await tx.portalToken.deleteMany({});

  const attachments = await tx.attachment.findMany({ select: { url: true } });
  await tx.attachment.deleteMany({});
  await deleteObjects(
    deps.storage,
    attachments.map((a) => a.url),
  );

  const exports = await tx.dataExport.findMany({ select: { fileUrl: true } });
  await tx.dataExport.deleteMany({});
  await deleteObjects(
    deps.storage,
    exports.map((e) => e.fileUrl).filter((key): key is string => Boolean(key)),
  );

  // Révocation des clés, jetons et identifiants fournisseurs.
  await tx.apiKey.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } });
  await tx.webhookEndpoint.updateMany({ data: { isActive: false, secret: "" } });
  await tx.channelConfig.updateMany({
    data: { isActive: false, credentials: "", webhookVerifyToken: null },
  });
  await tx.paymentProviderConfig.updateMany({ data: { isActive: false, credentials: "" } });
  await tx.fneConfig.updateMany({ data: { credentials: null } });
  await tx.dataSource.updateMany({ data: { isActive: false, config: "" } });
  await tx.trustedDevice.deleteMany({});

  const memberships = await tx.membership.findMany({ select: { userId: true } });
  await tx.membership.updateMany({
    data: {
      isActive: false,
      deactivatedAt: now,
      deactivationReason: "Compte supprimé",
      pinHash: null,
    },
  });
  await adminDb.session.deleteMany({
    where: {
      activeOrganizationId: organizationId,
      userId: { in: memberships.map((m) => m.userId) },
    },
  });

  await adminDb.organization.update({
    where: { id: organizationId },
    data: { lifecycleStatus: "PURGED", supportAccessUntil: null },
  });
  await writeAuditLog({
    organizationId,
    action: "org.deletion_purged",
    entity: "Organization",
    entityId: organizationId,
    after: { lifecycleStatus: "PURGED", customers: customers.length, vehicles: vehicles.length },
    reason:
      "Purge à l'échéance de la suppression programmée (J+30). Factures émises conservées anonymisées.",
  });
}

/** Tâche quotidienne : purge des organisations échues, puis expiration des exports. */
export async function processOrgPurgeJob(deps: OrgPurgeDeps = {}): Promise<{ purged: string[] }> {
  const clock = deps.clock ?? systemClock;
  const now = clock.now();
  const candidates = await adminDb.organization.findMany({
    where: { lifecycleStatus: "DELETION_SCHEDULED", deletionScheduledFor: { lte: now } },
    select: { id: true, lifecycleStatus: true, deletionScheduledFor: true },
  });
  const purged: string[] = [];
  for (const org of candidates) {
    if (
      !isDueForPurge({ ...org, lifecycleStatus: org.lifecycleStatus as OrgLifecycleStatus }, now)
    ) {
      continue;
    }
    try {
      await purgeOrganization(org.id, deps);
      purged.push(org.id);
      logger.info({ organizationId: org.id }, "org.purge : organisation purgée");
    } catch (error) {
      // Laissée en DELETION_SCHEDULED : reprise au prochain passage.
      logger.error(
        { organizationId: org.id, error: (error as Error).message },
        "org.purge : échec, nouvelle tentative au prochain passage",
      );
    }
  }
  return { purged };
}

/** Exports dont le lien de 48 h est échu : archive supprimée, statut EXPIRED. */
export async function expireDataExports(deps: OrgPurgeDeps = {}): Promise<number> {
  const now = (deps.clock ?? systemClock).now();
  const organizations = await adminDb.organization.findMany({ select: { id: true } });
  let expired = 0;
  for (const org of organizations) {
    const tx = db.forTenant({ organizationId: org.id });
    const due = await tx.dataExport.findMany({
      where: { status: "READY", expiresAt: { lte: now } },
      select: { id: true, fileUrl: true },
    });
    for (const row of due) {
      await deleteObjects(deps.storage, row.fileUrl ? [row.fileUrl] : []);
      await tx.dataExport.update({
        where: { id: row.id },
        data: { status: "EXPIRED", fileUrl: null },
      });
      expired += 1;
    }
  }
  return expired;
}
