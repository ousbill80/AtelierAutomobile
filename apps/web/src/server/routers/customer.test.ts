import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function ownerContextFor(organizationId: string, name: string) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: "OWNER", siteIds: [] },
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
  return { userId: user.id, membershipId: membership.id, token };
}

describe("customer router (M02)", () => {
  let orgA: { id: string };
  let ownerA: { userId: string; membershipId: string; token: string };
  let orgB: { id: string };
  let ownerB: { userId: string; membershipId: string; token: string };
  let reminderRuleA: { id: string };

  const userIds: string[] = [];

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Clients A", plan: "PRO" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Clients A");
    userIds.push(ownerA.userId);

    orgB = await adminDb.organization.create({ data: { name: "Garage Clients B", plan: "PRO" } });
    ownerB = await ownerContextFor(orgB.id, "Owner Clients B");
    userIds.push(ownerB.userId);

    reminderRuleA = await adminDb.reminderRule.create({
      data: {
        organizationId: orgA.id,
        type: "INSPECTION",
        name: "VT par défaut",
        steps: [{ key: "J-30", offsetDays: -30, templateKey: "vt_j30", autoSend: true }],
        sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00" },
        stopOn: ["appointment.created"],
      },
    });
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customerNote.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.reminder.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.duplicateDismissal.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.repairOrder.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.reminderRule.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("customer.create crée un client particulier et journalise customer.created", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "kouassi", firstName: "jean", phone: "0708111111" },
    });
    expect(result.customer.displayName).toBe("Kouassi Jean");
    expect(result.customer.phone).toBe("+2250708111111");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "customer.created", entityId: result.customer.id },
    });
    expect(log).not.toBeNull();
  });

  it("customer.create bloque sur doublon (RG-M02-07) puis accepte avec un motif", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "doublon", firstName: "test", phone: "0708222222" },
    });

    await expect(
      caller.customer.create({
        customer: {
          type: "INDIVIDUAL",
          lastName: "doublon",
          firstName: "test",
          phone: "0708222222",
        },
      }),
    ).rejects.toThrow("existe peut-être déjà");

    const forced = await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "doublon", firstName: "test", phone: "0708222222" },
      duplicateOverrideReason: "Confirmé par le client, ce sont deux personnes distinctes",
    });
    expect(forced.customer.displayName).toBe("Doublon Test");
    expect(forced.duplicates && forced.duplicates.length).toBeGreaterThan(0);
  });

  it("customer.update modifie les champs et recalcule le displayName", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const created = await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "martin" },
    });
    const updated = await caller.customer.update({
      id: created.customer.id,
      patch: { lastName: "martin", firstName: "paul", email: "paul.martin@example.com" },
    });
    expect(updated.displayName).toBe("Martin Paul");
    expect(updated.email).toBe("paul.martin@example.com");
  });

  it("customer.list et customer.get isolent les clients par organisation", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const callerB = callerFactory(await contextFor(ownerB.token));

    const createdA = await callerA.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "isolation A" },
    });
    await callerB.customer.create({ customer: { type: "INDIVIDUAL", lastName: "isolation B" } });

    const listA = await callerA.customer.list({});
    expect(listA.items.map((c) => c.id)).toContain(createdA.customer.id);

    const listB = await callerB.customer.list({});
    expect(listB.items.map((c) => c.id)).not.toContain(createdA.customer.id);

    await expect(callerB.customer.get({ id: createdA.customer.id })).rejects.toThrow();
  });

  it("customer.checkDuplicates retourne les candidats au-dessus du seuil", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "verification", phone: "0708333333" },
    });
    const candidates = await caller.customer.checkDuplicates({
      name: "Verification",
      phone: "0708333333",
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.level).not.toBe("NONE");
  });

  it("customer.duplicatesList détecte une paire et customer.duplicatesDismiss l'écarte", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "paire", firstName: "un", phone: "0708444444" },
      duplicateOverrideReason: "Besoin du scénario de test",
    });
    await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "paire", firstName: "un", phone: "0708444444" },
      duplicateOverrideReason: "Besoin du scénario de test",
    });

    const list = await caller.customer.duplicatesList({});
    const pair = list.items.find(
      (p) => p.displayNameA === "Paire Un" && p.displayNameB === "Paire Un",
    );
    expect(pair).toBeDefined();

    await caller.customer.duplicatesDismiss({
      customerIdA: pair!.customerIdA,
      customerIdB: pair!.customerIdB,
    });

    const listAfter = await caller.customer.duplicatesList({});
    const stillThere = listAfter.items.find(
      (p) => p.customerIdA === pair!.customerIdA && p.customerIdB === pair!.customerIdB,
    );
    expect(stillThere).toBeUndefined();
  });

  it("customer.mergePreview puis customer.merge fusionnent deux clients (RG-M02-08)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const source = await caller.customer.create({
      customer: {
        type: "INDIVIDUAL",
        lastName: "fusion source",
        phone: "0708555555",
        commune: "Cocody",
      },
    });
    const target = await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "fusion cible", email: "cible@example.com" },
    });
    const vehicle = await caller.vehicle.create({
      customerId: source.customer.id,
      plate: "8888 ZZ 10",
      make: "Toyota",
      model: "Yaris",
    });

    const preview = await caller.customer.mergePreview({
      sourceId: source.customer.id,
      targetId: target.customer.id,
    });
    expect(preview.documentsToMove.vehicles).toBe(1);
    const phoneField = preview.fields.find((f) => f.field === "phone");
    expect(phoneField).toBeDefined();

    const merged = await caller.customer.merge({
      sourceId: source.customer.id,
      targetId: target.customer.id,
      confirmName: source.customer.displayName,
      fieldChoices: { phone: "source" },
    });
    expect(merged.moved.vehicles).toBe(1);

    const targetAfter = await adminDb.customer.findUniqueOrThrow({
      where: { id: target.customer.id },
    });
    expect(targetAfter.phone).toBe(source.customer.phone);

    const sourceAfter = await adminDb.customer.findUniqueOrThrow({
      where: { id: source.customer.id },
    });
    expect(sourceAfter.deletedAt).not.toBeNull();
    expect(sourceAfter.mergedIntoId).toBe(target.customer.id);

    const movedVehicle = await adminDb.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(movedVehicle.customerId).toBe(target.customer.id);
  });

  it("customer.setConsent (doNotRemind) annule les relances planifiées puis reactivateReminders réactive", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const customer = await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "consentement", phone: "0708666666" },
    });

    const reminder = await adminDb.reminder.create({
      data: {
        organizationId: orgA.id,
        ruleId: reminderRuleA.id,
        type: "INSPECTION",
        stepKey: "J-30",
        customerId: customer.customer.id,
        dueDate: new Date("2026-12-01T00:00:00.000Z"),
        scheduledFor: new Date("2026-11-01T00:00:00.000Z"),
        dedupeKey: `INSPECTION:${customer.customer.id}:test`,
      },
    });

    const afterConsent = await caller.customer.setConsent({
      id: customer.customer.id,
      doNotRemind: true,
      reason: "Demande client",
      source: "phone",
    });
    expect(afterConsent.doNotRemind).toBe(true);

    const cancelled = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(cancelled.status).toBe("CANCELLED");

    const reactivated = await caller.customer.reactivateReminders({
      id: customer.customer.id,
      source: "phone",
    });
    expect(reactivated.doNotRemind).toBe(false);
    expect(reactivated.optedOutAt).toBeNull();
  });

  it("customer.setCredit met à jour les conditions de paiement", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const customer = await caller.customer.create({
      customer: { type: "COMPANY", companyName: "Transport Express" },
    });
    const updated = await caller.customer.setCredit({
      id: customer.customer.id,
      paymentTermsDays: 30,
      creditLimit: 500000,
    });
    expect(updated.paymentTermsDays).toBe(30);
    expect(updated.creditLimit).toBe(500000);
  });

  it("customer.addNote puis customer.timeline retrouvent la note (US-M02-10)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const customer = await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "chronologie" },
    });
    const note = await caller.customer.addNote({
      customerId: customer.customer.id,
      body: "Client courtois, règle toujours en espèces.",
      pinned: true,
    });
    expect(note.pinned).toBe(true);

    const timeline = await caller.customer.timeline({
      id: customer.customer.id,
      types: ["note"],
    });
    expect(timeline.items.some((i) => i.id === note.id && i.type === "note")).toBe(true);
  });

  it("customer.delete refuse un client avec un OR ouvert puis réussit une fois clôturé", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const customer = await caller.customer.create({
      customer: { type: "INDIVIDUAL", lastName: "suppression" },
    });
    const vehicle = await caller.vehicle.create({
      customerId: customer.customer.id,
      plate: "6666 XY 11",
      make: "Honda",
      model: "Civic",
    });
    const site = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Site Clients A", code: "CLA" },
    });
    const repairOrder = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: site.id,
        number: "OR-CLA-2026-00001",
        customerId: customer.customer.id,
        vehicleId: vehicle.id,
        status: "IN_PROGRESS",
      },
    });

    await expect(
      caller.customer.delete({ id: customer.customer.id, reason: "Test" }),
    ).rejects.toThrow("OR est en cours");

    await adminDb.repairOrder.update({
      where: { id: repairOrder.id },
      data: { status: "DELIVERED" },
    });
    const deleted = await caller.customer.delete({ id: customer.customer.id, reason: "Doublon" });
    expect(deleted.ok).toBe(true);
  });

  it("customer.exportData renvoie les données du client et customer.anonymize efface les PII", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const customer = await caller.customer.create({
      customer: {
        type: "INDIVIDUAL",
        lastName: "export",
        phone: "0708777777",
        email: "export@example.com",
      },
    });

    const exported = await caller.customer.exportData({ id: customer.customer.id });
    expect(exported.data.id).toBe(customer.customer.id);

    const anonymized = await caller.customer.anonymize({
      id: customer.customer.id,
      reason: "Demande RGPD",
      confirm: true,
    });
    expect(anonymized.ok).toBe(true);

    const after = await adminDb.customer.findUniqueOrThrow({ where: { id: customer.customer.id } });
    expect(after.phone).toBeNull();
    expect(after.email).toBeNull();
    expect(after.anonymizedAt).not.toBeNull();
    expect(after.displayName).toContain("Client anonymisé");
  });
});
