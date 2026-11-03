// Échéances › « Relancer » (M10) : canaux choisis, un message par véhicule,
// refus clairs, isolation multi-locataire.
import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function callerFor(organizationId: string, name: string) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
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
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return { userId: user.id, caller: callerFactory(ctx) };
}

function inDays(days: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

describe("reminders.dueRemind (Échéances › Relancer)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  const users: string[] = [];
  let callerA: ReturnType<typeof callerFactory>;
  let callerB: ReturnType<typeof callerFactory>;
  let car1: { id: string };
  let car2: { id: string };
  let car3: { id: string };
  let noPhoneCar: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Échéances A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Échéances B" } });
    const a = await callerFor(orgA.id, "Owner Échéances A");
    const b = await callerFor(orgB.id, "Owner Échéances B");
    users.push(a.userId, b.userId);
    callerA = a.caller;
    callerB = b.caller;

    await adminDb.reminderRule.create({
      data: {
        organizationId: orgA.id,
        type: "INSPECTION",
        name: "Visite technique",
        isActive: true,
        steps: [
          {
            key: "J-30",
            label: "1er rappel",
            offsetDays: -30,
            templateKey: "vt_j30",
            autoSend: true,
            channels: ["WHATSAPP", "SMS"],
          },
        ],
        sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00" },
        conditions: {},
        stopOn: [],
      },
    });
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgA.id,
        channel: "SMS",
        provider: "console",
        isActive: true,
        credentials: "",
      },
    });
    const multi = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Client Deux Voitures",
        type: "INDIVIDUAL",
        phone: "+2250747210101",
        remindersConsent: true,
      },
    });
    const noPhone = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Client Sans Contact",
        type: "INDIVIDUAL",
        remindersConsent: true,
      },
    });
    const vehicle = (customerId: string, plate: string, due: Date | null) =>
      adminDb.vehicle.create({
        data: {
          organizationId: orgA.id,
          customerId,
          plate,
          plateCompact: plate.replace(/\s/g, ""),
          make: "Toyota",
          model: "Corolla",
          inspectionExpiryDate: due,
        },
      });
    car1 = await vehicle(multi.id, "1111 EC 01", inDays(10));
    car2 = await vehicle(multi.id, "2222 EC 01", inDays(40));
    car3 = await vehicle(multi.id, "3333 EC 01", inDays(200));
    noPhoneCar = await vehicle(noPhone.id, "4444 EC 01", inDays(5));
  });

  afterAll(async () => {
    const orgs = { organizationId: { in: [orgA.id, orgB.id] } };
    await adminDb.reminder.deleteMany({ where: orgs });
    await adminDb.reminderRule.deleteMany({ where: orgs });
    await adminDb.channelConfig.deleteMany({ where: orgs });
    await adminDb.vehicle.deleteMany({ where: orgs });
    await adminDb.customer.deleteMany({ where: orgs });
    await adminDb.auditLog.deleteMany({ where: orgs });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where: orgs });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("l'aperçu propose les autres véhicules du client bientôt à échéance et indique les canaux", async () => {
    const preview = await callerA.reminders.dueRemindPreview({
      kind: "INSPECTION",
      vehicleIds: [car1.id, noPhoneCar.id],
    });
    const byId = new Map(preview.vehicles.map((v) => [v.vehicleId, v]));
    expect(byId.get(car1.id)).toMatchObject({ eligible: true, suggested: false });
    // Échéance dans 40 jours : proposée dans le même message ; dans 200 jours : non.
    expect(byId.get(car2.id)).toMatchObject({ eligible: true, suggested: true });
    expect(byId.has(car3.id)).toBe(false);
    expect(byId.get(noPhoneCar.id)).toMatchObject({ eligible: false });
    expect(byId.get(noPhoneCar.id)?.reasonMessage).toMatch(/fiche client/);
    expect(preview.channels.find((c) => c.channel === "SMS")?.mode).toBe("test");
    expect(preview.channels.find((c) => c.channel === "EMAIL")?.mode).toBe("off");
  });

  it("deux véhicules du même client = un message pour chacun ; le client sans contact est écarté", async () => {
    const result = await callerA.reminders.dueRemind({
      kind: "INSPECTION",
      vehicleIds: [car1.id, car2.id, noPhoneCar.id],
      channels: ["SMS", "EMAIL"],
    });
    expect(result).toMatchObject({ customers: 1, vehicles: 2, messages: 2 });
    expect(result.skipped).toEqual([
      expect.objectContaining({ plate: "4444 EC 01", customerName: "Client Sans Contact" }),
    ]);
    const reminders = await adminDb.reminder.findMany({
      where: { organizationId: orgA.id, stepKey: "MANUAL" },
    });
    expect(reminders).toHaveLength(2);
    for (const r of reminders) {
      // Prêtes pour le dispatch : approuvées, canal imposé, échéance du véhicule (revérifiée).
      expect(r.channel).toBe("SMS");
      expect(r.channelLocked).toBe(true);
      expect(r.approvedAt).not.toBeNull();
      expect(["PLANNED", "QUEUED", "SENT"]).toContain(r.status);
    }
    const car1Reminder = reminders.find((r) => r.vehicleId === car1.id)!;
    expect(car1Reminder.dueDate.toISOString().slice(0, 10)).toBe(
      inDays(10).toISOString().slice(0, 10),
    );
  });

  it("anti-doublon : un véhicule déjà relancé n'est pas relancé une deuxième fois", async () => {
    const preview = await callerA.reminders.dueRemindPreview({
      kind: "INSPECTION",
      vehicleIds: [car1.id],
    });
    expect(preview.vehicles.find((v) => v.vehicleId === car1.id)?.eligible).toBe(false);
    const again = await callerA.reminders.dueRemind({
      kind: "INSPECTION",
      vehicleIds: [car1.id],
      channels: ["SMS"],
    });
    expect(again.messages).toBe(0);
    expect(again.skipped).toHaveLength(1);
  });

  it("sans règle pour ce type d'échéance : message actionnable", async () => {
    await expect(
      callerA.reminders.dueRemind({ kind: "SERVICE", vehicleIds: [car3.id], channels: ["SMS"] }),
    ).rejects.toThrow(/Paramètres › Relances/);
  });

  it("isolation : un autre garage ne voit ni ne relance ces véhicules", async () => {
    const preview = await callerB.reminders.dueRemindPreview({
      kind: "INSPECTION",
      vehicleIds: [car3.id],
    });
    expect(preview.vehicles).toEqual([]);
    await expect(
      callerB.reminders.dueRemind({ kind: "INSPECTION", vehicleIds: [car3.id], channels: ["SMS"] }),
    ).rejects.toThrow(/Paramètres › Relances/);
    const count = await adminDb.reminder.count({ where: { organizationId: orgB.id } });
    expect(count).toBe(0);
  });
});
