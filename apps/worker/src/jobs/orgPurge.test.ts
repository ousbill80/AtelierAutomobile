import { fixedClock } from "@atelieros/core";
import { adminDb, deleteTestOrganizations } from "@atelieros/db";
import { afterAll, describe, expect, it } from "vitest";
import { autoMessageQuotaState, recordAutoMessage } from "./autoMessageQuota";
import { expireDataExports, processOrgPurgeJob } from "./orgPurge";

// M15 §12 — purge après J+30 avec horloge simulée ; expiration des exports ; quota mensuel.

const orgIds: string[] = [];
const userIds: string[] = [];
const SCHEDULED = new Date("2026-11-19T10:00:00.000Z");

afterAll(async () => {
  await deleteTestOrganizations(orgIds, userIds);
});

async function seed(label: string, scheduled: boolean) {
  const org = await adminDb.organization.create({
    data: {
      name: `Garage Purge ${label}`,
      lifecycleStatus: scheduled ? "DELETION_SCHEDULED" : "ACTIVE",
      deletionRequestedAt: scheduled ? new Date("2026-10-20T10:00:00.000Z") : null,
      deletionScheduledFor: scheduled ? SCHEDULED : null,
    },
  });
  orgIds.push(org.id);
  const user = await adminDb.user.create({
    data: { name: `Gérant ${label}`, email: `purge-${org.id}@example.com` },
  });
  userIds.push(user.id);
  await adminDb.membership.create({
    data: { organizationId: org.id, userId: user.id, role: "OWNER", siteIds: [] },
  });
  const site = await adminDb.site.create({
    data: { organizationId: org.id, name: "Atelier", code: "ABJ" },
  });
  const customer = await adminDb.customer.create({
    data: {
      organizationId: org.id,
      displayName: "Kouassi Jean-Marc",
      firstName: "Jean-Marc",
      lastName: "Kouassi",
      phone: "+2250701020304",
      email: "kouassi@example.com",
    },
  });
  await adminDb.vehicle.create({
    data: {
      organizationId: org.id,
      customerId: customer.id,
      plate: "2547 GH 01",
      plateCompact: "2547GH01",
      make: "Toyota",
      model: "Corolla",
      vin: "JTDBR32E720123456",
    },
  });
  await adminDb.message.create({
    data: {
      organizationId: org.id,
      customerId: customer.id,
      direction: "OUTBOUND",
      channel: "WHATSAPP",
      to: "+2250701020304",
      body: "Bonjour M. Kouassi, votre visite technique expire bientôt.",
      provider: "console",
    },
  });
  await adminDb.channelConfig.create({
    data: {
      organizationId: org.id,
      channel: "SMS",
      provider: "twilio",
      isActive: true,
      credentials: "v1:chiffré",
    },
  });
  const invoice = await adminDb.invoice.create({
    data: {
      organizationId: org.id,
      siteId: site.id,
      customerId: customer.id,
      number: "FAC-2026-000001",
      status: "PAID",
      issuedAt: new Date("2026-10-01T10:00:00.000Z"),
      total: 17_700,
      amountPaid: 17_700,
    },
  });
  return { org, customer, invoice };
}

describe("org.purge (RG-M15-22)", () => {
  it("ne purge rien avant J+30, puis anonymise à l'échéance en conservant les factures", async () => {
    const scheduled = await seed("programmée", true);
    const active = await seed("active", false);

    let result = await processOrgPurgeJob({ clock: fixedClock(new Date(SCHEDULED.getTime() - 1)) });
    expect(result.purged).not.toContain(scheduled.org.id);

    result = await processOrgPurgeJob({ clock: fixedClock(SCHEDULED) });
    expect(result.purged).toContain(scheduled.org.id);
    expect(result.purged).not.toContain(active.org.id);

    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: scheduled.org.id } });
    expect(org.lifecycleStatus).toBe("PURGED");

    const customer = await adminDb.customer.findUniqueOrThrow({
      where: { id: scheduled.customer.id },
    });
    expect(customer.displayName).toMatch(/^Client supprimé #[0-9a-f]{8}$/);
    expect(customer.phone).toBeNull();
    expect(customer.email).toBeNull();
    expect(customer.firstName).toBeNull();
    expect(customer.anonymizedAt).not.toBeNull();

    const invoice = await adminDb.invoice.findUniqueOrThrow({
      where: { id: scheduled.invoice.id },
    });
    expect(invoice.number).toBe("FAC-2026-000001");
    expect(invoice.total).toBe(17_700);

    const vehicle = await adminDb.vehicle.findFirstOrThrow({
      where: { organizationId: scheduled.org.id },
    });
    expect(vehicle.plate).toMatch(/^ANONYME-/);
    expect(vehicle.vin).toBeNull();
    const message = await adminDb.message.findFirstOrThrow({
      where: { organizationId: scheduled.org.id },
    });
    expect(message.body).toBe("[supprimé]");
    expect(message.to).toBe("");
    const channel = await adminDb.channelConfig.findFirstOrThrow({
      where: { organizationId: scheduled.org.id },
    });
    expect(channel).toMatchObject({ isActive: false, credentials: "" });
    expect(
      await adminDb.membership.count({
        where: { organizationId: scheduled.org.id, isActive: true },
      }),
    ).toBe(0);
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: scheduled.org.id, action: "org.deletion_purged" },
    });
    expect(audit).not.toBeNull();

    // L'organisation active n'est pas touchée.
    const untouched = await adminDb.customer.findUniqueOrThrow({
      where: { id: active.customer.id },
    });
    expect(untouched.displayName).toBe("Kouassi Jean-Marc");

    // Idempotent : un second passage ne fait rien.
    result = await processOrgPurgeJob({ clock: fixedClock(SCHEDULED) });
    expect(result.purged).not.toContain(scheduled.org.id);
  });

  it("expire les exports après 48 h et supprime l'archive", async () => {
    const { org } = await seed("export", false);
    const membership = await adminDb.membership.findFirstOrThrow({
      where: { organizationId: org.id },
    });
    const row = await adminDb.dataExport.create({
      data: {
        organizationId: org.id,
        requestedById: membership.id,
        status: "READY",
        fileUrl: `exports/${org.id}/x.zip`,
        expiresAt: new Date("2026-10-22T10:00:00.000Z"),
      },
    });
    const deleted: string[] = [];
    const storage = { deleteObject: async (key: string) => void deleted.push(key) };
    await expireDataExports({ storage, clock: fixedClock(new Date("2026-10-22T09:00:00.000Z")) });
    expect((await adminDb.dataExport.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "READY",
    );
    await expireDataExports({ storage, clock: fixedClock(new Date("2026-10-22T10:00:00.000Z")) });
    const after = await adminDb.dataExport.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: "EXPIRED", fileUrl: null });
    expect(deleted).toContain(`exports/${org.id}/x.zip`);
  });
});

describe("quota de messages automatiques (RG-M15-20)", () => {
  it("notifie à 80 % puis à 100 %, une seule fois par période", async () => {
    const { org } = await seed("quota", false);
    await adminDb.organization.update({
      where: { id: org.id },
      data: { planOverrides: { autoMessagesPerMonth: 5 } },
    });
    const now = new Date("2026-10-20T10:00:00.000Z");
    for (let i = 0; i < 4; i++) await recordAutoMessage(org.id, now);
    expect((await autoMessageQuotaState(org.id, now)).reached).toBe(false);
    let notes = await adminDb.notification.findMany({ where: { organizationId: org.id } });
    expect(notes.map((n) => n.type)).toEqual(["plan.limit_warning"]);

    await recordAutoMessage(org.id, now);
    expect(await autoMessageQuotaState(org.id, now)).toMatchObject({
      reached: true,
      used: 5,
      limit: 5,
    });
    await recordAutoMessage(org.id, now);
    notes = await adminDb.notification.findMany({ where: { organizationId: org.id } });
    expect(notes.map((n) => n.type).sort()).toEqual(["plan.limit_reached", "plan.limit_warning"]);

    // Nouveau mois : compteur repart de zéro.
    expect((await autoMessageQuotaState(org.id, new Date("2026-11-01T00:30:00.000Z"))).used).toBe(
      0,
    );
  });
});
