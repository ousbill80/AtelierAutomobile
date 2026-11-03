import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, db, deleteTestOrganizations } from "@atelieros/db";
import { raiseInternalAlert } from "./remindersPlan";

// M10 §5.2 — palier internalOnly (alerte gérant J+45) : notification à chaque OWNER actif,
// escalade du dossier de créance, idempotent pour une même relance.
describe("raiseInternalAlert", () => {
  let orgId: string;
  const userIds: string[] = [];
  let ownerId: string;
  let inactiveOwnerId: string;
  let advisorId: string;
  let customerId: string;
  let caseId: string;
  const now = new Date("2026-11-02T08:00:00Z");

  beforeAll(async () => {
    const org = await adminDb.organization.create({ data: { name: "Test Alerte J+45" } });
    orgId = org.id;
    const member = async (role: "OWNER" | "ADVISOR", isActive = true) => {
      const user = await adminDb.user.create({
        data: { name: `${role} test`, email: `${role}-${isActive}-${org.id}@example.com` },
      });
      userIds.push(user.id);
      return adminDb.membership.create({
        data: { organizationId: org.id, userId: user.id, role, siteIds: [], isActive },
      });
    };
    ownerId = (await member("OWNER")).id;
    inactiveOwnerId = (await member("OWNER", false)).id;
    advisorId = (await member("ADVISOR")).id;
    const customer = await adminDb.customer.create({
      data: { organizationId: orgId, displayName: "SOTRA Logistique", type: "COMPANY" },
    });
    customerId = customer.id;
    caseId = (await adminDb.collectionCase.create({ data: { organizationId: orgId, customerId } }))
      .id;
  });

  afterAll(async () => {
    await deleteTestOrganizations([orgId], userIds);
  });

  it("notifie les OWNER actifs, escalade la créance, sans doublon au second passage", async () => {
    const tenantDb = db.forTenant({ organizationId: orgId });
    const input = {
      organizationId: orgId,
      reminderId: "rem_test_j45",
      type: "RECEIVABLE",
      stepLabel: "Alerte gérant J+45",
      customerId,
      invoiceId: null,
      now,
    };
    await raiseInternalAlert(tenantDb, input);
    await raiseInternalAlert(tenantDb, input);

    const notifications = await adminDb.notification.findMany({ where: { organizationId: orgId } });
    expect(notifications.map((n) => n.membershipId)).toEqual([ownerId]);
    expect(notifications.map((n) => n.membershipId)).not.toContain(inactiveOwnerId);
    expect(notifications.map((n) => n.membershipId)).not.toContain(advisorId);
    expect(notifications[0]).toMatchObject({
      type: "reminder.internal_alert",
      title: "Créance à reprendre en main : SOTRA Logistique",
      link: `/creances/${caseId}`,
      severity: "warning",
      pushedAt: null,
    });

    const kase = await adminDb.collectionCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(kase.status).toBe("ESCALATED");
    expect(kase.escalatedAt?.toISOString()).toBe(now.toISOString());
  });
});
