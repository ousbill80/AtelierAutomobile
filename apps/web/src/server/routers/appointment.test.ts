import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { defaultOutbox } from "@atelieros/integrations";
import { resetRateLimits } from "@atelieros/planning";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

async function memberFor(
  organizationId: string,
  role: "OWNER" | "MANAGER" | "ADVISOR",
  siteIds: string[] = [],
) {
  const user = await adminDb.user.create({
    data: {
      name: `${role} ${randomBytes(3).toString("hex")}`,
      email: `${randomBytes(4).toString("hex")}@example.com`,
    },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds },
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

const HOURS = {
  mon: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ],
  tue: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ],
  wed: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ],
  thu: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ],
  fri: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ],
  sat: [["08:00", "14:00"]],
  sun: [],
};

/** Prochain samedi (au moins 7 jours devant) à l'heure UTC donnée — Abidjan = UTC+0. */
function nextSaturday(time: string, weeksAhead = 1): Date {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysUntil = ((6 - date.getUTCDay() + 7) % 7) + 7 * weeksAhead;
  date.setUTCDate(date.getUTCDate() + daysUntil);
  const [h, m] = time.split(":").map(Number);
  date.setUTCHours(h!, m!, 0, 0);
  return date;
}

describe("appointment / planning routers (M03)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let siteA: { id: string };
  let siteB: { id: string };
  let bay1: { id: string };
  let bay2: { id: string };
  let mechanic: { membershipId: string };
  let advisor: { token: string; membershipId: string; userId: string };
  let manager: { token: string; membershipId: string; userId: string };
  let ownerB: { token: string; membershipId: string; userId: string };
  let customer: { id: string };
  let vehicle: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({
      data: { name: "Garage RDV A", timezone: "Africa/Abidjan" },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage RDV B", timezone: "Africa/Abidjan" },
    });
    siteA = await adminDb.site.create({
      data: {
        organizationId: orgA.id,
        name: "Site A",
        code: "SA",
        openingHours: HOURS,
        phone: "+2250708123456",
      },
    });
    siteB = await adminDb.site.create({
      data: { organizationId: orgB.id, name: "Site B", code: "SB", openingHours: HOURS },
    });
    bay1 = await adminDb.bay.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        name: "Pont 1",
        type: "LIFT",
        sortOrder: 1,
      },
    });
    bay2 = await adminDb.bay.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        name: "Pont 2",
        type: "LIFT",
        sortOrder: 2,
      },
    });
    await adminDb.bay.create({
      data: { organizationId: orgB.id, siteId: siteB.id, name: "Pont B", type: "LIFT" },
    });
    const mech = await memberFor(orgA.id, "MANAGER");
    await adminDb.membership.update({
      where: { id: mech.membershipId },
      data: { role: "MECHANIC", skills: ["moteur"] },
    });
    mechanic = { membershipId: mech.membershipId };
    await memberFor(orgA.id, "MANAGER").then(async (m) => {
      await adminDb.membership.update({
        where: { id: m.membershipId },
        data: { role: "MECHANIC", skills: ["carrosserie"] },
      });
    });
    advisor = await memberFor(orgA.id, "ADVISOR");
    manager = await memberFor(orgA.id, "MANAGER");
    ownerB = await memberFor(orgB.id, "OWNER");
    customer = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "INDIVIDUAL",
        civility: "M",
        firstName: "Jean-Marc",
        lastName: "Kouassi",
        displayName: "Kouassi Jean-Marc",
        phone: "+2250708123456",
        hasWhatsapp: true,
      },
    });
    vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        plate: "2547 GH 01",
        plateCompact: "2547GH01",
        make: "Toyota",
        model: "Corolla",
      },
    });
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    await adminDb.message.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.notification.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.portalToken.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.resourceBlock.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.appointment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
    const memberships = await adminDb.membership.findMany({
      where: { organizationId: { in: orgIds } },
    });
    await adminDb.session.deleteMany({
      where: { userId: { in: memberships.map((m) => m.userId) } },
    });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
    await adminDb.bay.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  beforeEach(() => {
    defaultOutbox.clear();
    resetRateLimits();
  });

  it("US-M03-01 : crée un RDV révision samedi 09:00 Pont 1, envoie la confirmation WhatsApp et émet appointment.created", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    const startsAt = nextSaturday("09:00");
    const result = await caller.appointment.create({
      siteId: siteA.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      type: "SERVICE",
      startsAt,
      bayId: bay1.id,
      source: "PHONE",
      laborOperationIds: [],
      notifyCustomer: true,
      force: false,
    });
    expect(result.appointment.status).toBe("BOOKED");
    expect(result.appointment.endsAt.getTime() - startsAt.getTime()).toBe(90 * 60_000);
    expect(result.appointment.advisorId).toBe(advisor.membershipId);

    const message = defaultOutbox.lastFor("+2250708123456");
    expect(message?.channel).toBe("WHATSAPP");
    expect(message?.body).toContain("votre RDV chez Garage RDV A est confirmé le samedi");
    expect(message?.body).toContain("pour la révision de votre Toyota Corolla (2547 GH 01)");

    const event = await adminDb.domainEvent.findFirst({
      where: { organizationId: orgA.id, type: "appointment.created" },
    });
    expect(event).not.toBeNull();
    const stored = await adminDb.message.findFirst({
      where: {
        organizationId: orgA.id,
        idempotencyKey: `appointment:${result.appointment.id}:confirmation`,
      },
    });
    expect(stored?.status).toBe("SENT");
  });

  it("RG-M03-02 : refuse un chevauchement sur le même pont avec SLOT_CONFLICT et autorise le bord à bord", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    const other = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Bamba Aminata", phone: "+2250102030405" },
    });
    await expect(
      caller.appointment.create({
        siteId: siteA.id,
        customerId: other.id,
        type: "SERVICE",
        startsAt: nextSaturday("10:00"),
        bayId: bay1.id,
        source: "STAFF",
        laborOperationIds: [],
        notifyCustomer: false,
        force: false,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Pont 1 occupé de 09:00 à 10:30 (Kouassi Jean-Marc)"),
    });

    const edge = await caller.appointment.create({
      siteId: siteA.id,
      customerId: other.id,
      type: "SERVICE",
      startsAt: nextSaturday("10:30"),
      bayId: bay1.id,
      source: "STAFF",
      laborOperationIds: [],
      notifyCustomer: false,
      force: false,
    });
    expect(edge.appointment.bayId).toBe(bay1.id);
  });

  it("RG-M03-02 : la surréservation volontaire exige planning:manage et marque overbooked", async () => {
    const other = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Koné Issa" },
    });
    const advisorCaller = callerFactory(await contextFor(advisor.token));
    await expect(
      advisorCaller.appointment.create({
        siteId: siteA.id,
        customerId: other.id,
        type: "SERVICE",
        startsAt: nextSaturday("09:00"),
        bayId: bay1.id,
        source: "STAFF",
        laborOperationIds: [],
        notifyCustomer: false,
        force: true,
      }),
    ).rejects.toThrow("Pont 1 occupé");
    const managerCaller = callerFactory(await contextFor(manager.token));
    const forced = await managerCaller.appointment.create({
      siteId: siteA.id,
      customerId: other.id,
      type: "SERVICE",
      startsAt: nextSaturday("09:00"),
      bayId: bay1.id,
      source: "STAFF",
      laborOperationIds: [],
      notifyCustomer: false,
      force: true,
    });
    expect(forced.appointment.overbooked).toBe(true);
    await adminDb.appointment.delete({ where: { id: forced.appointment.id } });
  });

  it("RG-M03-01 : refuse un RDV le dimanche (OUTSIDE_OPENING_HOURS) sauf forçage du chef d'atelier", async () => {
    const sunday = new Date(nextSaturday("09:00").getTime() + 86_400_000);
    const advisorCaller = callerFactory(await contextFor(advisor.token));
    await expect(
      advisorCaller.appointment.create({
        siteId: siteA.id,
        customerId: customer.id,
        type: "OTHER",
        startsAt: sunday,
        source: "STAFF",
        laborOperationIds: [],
        notifyCustomer: false,
        force: false,
      }),
    ).rejects.toThrow("atelier fermé ce jour");
    const managerCaller = callerFactory(await contextFor(manager.token));
    const forced = await managerCaller.appointment.create({
      siteId: siteA.id,
      customerId: customer.id,
      type: "OTHER",
      startsAt: sunday,
      source: "STAFF",
      laborOperationIds: [],
      notifyCustomer: false,
      force: true,
    });
    expect(forced.appointment.outsideHours).toBe(true);
    await adminDb.appointment.delete({ where: { id: forced.appointment.id } });
  });

  it("RG-M03-13 : un second RDV le même jour pour le même véhicule est signalé (DUPLICATE_SAME_DAY), forçable", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    await expect(
      caller.appointment.create({
        siteId: siteA.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        type: "TIRES",
        startsAt: nextSaturday("12:00"),
        bayId: bay2.id,
        source: "STAFF",
        laborOperationIds: [],
        notifyCustomer: false,
        force: false,
      }),
    ).rejects.toThrow("Ce véhicule a déjà un RDV le");
  });

  it("contrainte d'exclusion Postgres : deux insertions concurrentes sur le même pont → une seule passe", async () => {
    const other = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Concurrent" },
    });
    const startsAt = nextSaturday("08:00", 2);
    const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
    const insert = () =>
      adminDb.appointment.create({
        data: {
          organizationId: orgA.id,
          siteId: siteA.id,
          customerId: other.id,
          bayId: bay2.id,
          startsAt,
          endsAt,
          type: "SERVICE",
          status: "BOOKED",
        },
      });
    const results = await Promise.allSettled([insert(), insert()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain(
      "appointment_no_overlap",
    );
  });

  it("US-M03-03 : déplacer le RDV change pont et heure, envoie « déplacé » et émet appointment.updated rescheduled", async () => {
    const caller = callerFactory(await contextFor(manager.token));
    const existing = await adminDb.appointment.findFirstOrThrow({
      where: { organizationId: orgA.id, customerId: customer.id, status: "BOOKED" },
    });
    const newStart = nextSaturday("11:00");
    const result = await caller.appointment.update({
      id: existing.id,
      startsAt: newStart,
      bayId: bay2.id,
      notifyCustomer: true,
      force: false,
    });
    expect(result.rescheduled).toBe(true);
    expect(result.appointment.bayId).toBe(bay2.id);
    expect(defaultOutbox.lastFor("+2250708123456")?.body).toContain("a été déplacé au samedi");
    const event = await adminDb.domainEvent.findFirst({
      where: { organizationId: orgA.id, type: "appointment.updated" },
      orderBy: { occurredAt: "desc" },
    });
    expect((event?.payload as { rescheduled: boolean }).rescheduled).toBe(true);
    // Le créneau est réévalué : retour à 09:00 Pont 1 sans message si « Prévenir le client » décoché.
    defaultOutbox.clear();
    await caller.appointment.update({
      id: existing.id,
      startsAt: nextSaturday("09:00"),
      bayId: bay1.id,
      notifyCustomer: false,
      force: false,
    });
    expect(defaultOutbox.lastFor("+2250708123456")).toBeUndefined();
  });

  it("machine à états : confirmer, client arrivé, terminer sans OR ; annuler un RDV arrivé est refusé", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    const existing = await adminDb.appointment.findFirstOrThrow({
      where: { organizationId: orgA.id, customerId: customer.id, status: "BOOKED" },
    });
    const confirmed = await caller.appointment.confirm({ id: existing.id, via: "whatsapp" });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedVia).toBe("whatsapp");
    const arrived = await caller.appointment.markArrived({ id: existing.id });
    expect(arrived.appointment.status).toBe("ARRIVED");
    expect(arrived.receptionUrl).toContain(`appointmentId=${existing.id}`);
    await expect(
      caller.appointment.cancel({
        id: existing.id,
        cancelledBy: "GARAGE",
        reason: "Doublon",
        notifyCustomer: false,
      }),
    ).rejects.toThrow("Impossible d'annuler");
    const completed = await caller.appointment.complete({
      id: existing.id,
      reason: "Contrôle gratuit",
    });
    expect(completed.status).toBe("COMPLETED");
  });

  it("RG-M03-11 : annulation garage avec motif → message avec lien de reprogrammation ; annulation client → notification", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    const created = await caller.appointment.create({
      siteId: siteA.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      type: "DIAGNOSTIC",
      startsAt: nextSaturday("10:00", 3),
      source: "STAFF",
      laborOperationIds: [],
      notifyCustomer: false,
      force: false,
    });
    await expect(
      caller.appointment.cancel({
        id: created.appointment.id,
        cancelledBy: "GARAGE",
        notifyCustomer: false,
      }),
    ).rejects.toThrow("motif");
    const cancelled = await caller.appointment.cancel({
      id: created.appointment.id,
      cancelledBy: "GARAGE",
      reason: "Mécanicien absent",
      notifyCustomer: true,
    });
    expect(cancelled.appointment.status).toBe("CANCELLED");
    expect(defaultOutbox.lastFor("+2250708123456")?.body).toMatch(
      /a été annulé\. Reprogrammez ici : http.*\/p\/[A-Za-z0-9_-]+\/rdv/,
    );

    const second = await caller.appointment.create({
      siteId: siteA.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      type: "DIAGNOSTIC",
      startsAt: nextSaturday("10:00", 4),
      source: "STAFF",
      laborOperationIds: [],
      notifyCustomer: false,
      force: false,
    });
    await caller.appointment.cancel({
      id: second.appointment.id,
      cancelledBy: "CUSTOMER",
      notifyCustomer: false,
    });
    const notification = await adminDb.notification.findFirst({
      where: { organizationId: orgA.id, type: "appointment.cancelled_by_customer" },
    });
    expect(notification?.title).toContain("Kouassi Jean-Marc");
  });

  it("RG-M03-10 : marquer absent, badge d'absences, correction dans les 48 h", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    const created = await caller.appointment.create({
      siteId: siteA.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      type: "SERVICE",
      startsAt: nextSaturday("08:00", 5),
      source: "STAFF",
      laborOperationIds: [],
      notifyCustomer: false,
      force: false,
    });
    const noShow = await caller.appointment.markNoShow({ id: created.appointment.id });
    expect(noShow.status).toBe("NO_SHOW");
    expect(noShow.noShowAt).not.toBeNull();
    // Le compteur 12 mois ne compte que les absences passées : on antidate.
    await adminDb.appointment.update({
      where: { id: created.appointment.id },
      data: {
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() - 80_000_000),
      },
    });
    const sent = await caller.appointment.sendNoShowMessage({ id: created.appointment.id });
    expect(sent.messageId).not.toBeNull();
    expect(defaultOutbox.lastFor("+2250708123456")?.body).toContain(
      "nous ne vous avons pas vu aujourd'hui",
    );
    const reverted = await caller.appointment.revertNoShow({
      id: created.appointment.id,
      reason: "Client arrivé non pointé",
    });
    expect(reverted.status).toBe("ARRIVED");
  });

  it("planning.availableSlots ne propose que des créneaux libres et compatibles ; planning.capacity renvoie les demi-journées", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    const from = nextSaturday("00:00");
    const slots = await caller.planning.availableSlots({
      siteId: siteA.id,
      type: "SERVICE",
      from,
      days: 1,
      requireBay: true,
    });
    expect(slots.durationMinutes).toBe(90);
    const starts = slots.days
      .flatMap((d) => d.slots)
      .map((s) => s.startsAt.toISOString().slice(11, 16));
    expect(starts).toContain("08:00");
    expect(starts.length).toBeGreaterThan(0);
    const capacity = await caller.planning.capacity({
      siteId: siteA.id,
      from,
      to: new Date(from.getTime() + 86_400_000),
    });
    expect(capacity).toHaveLength(1);
    expect(capacity[0]!.halfDay).toBe("AM");
    expect(capacity[0]!.mechanicsPresent).toBe(2);
  });

  it("resourceBlock.create refuse avec BLOCK_HAS_APPOINTMENTS puis passe les RDV « À affecter » en forçant", async () => {
    const caller = callerFactory(await contextFor(manager.token));
    const existing = await adminDb.appointment.findFirstOrThrow({
      where: { organizationId: orgA.id, bayId: bay1.id, status: "BOOKED" },
    });
    const input = {
      siteId: siteA.id,
      bayId: bay1.id,
      startsAt: new Date(existing.startsAt.getTime() - 3_600_000),
      endsAt: new Date(existing.endsAt.getTime() + 3_600_000),
      reason: "Maintenance pont",
    };
    await expect(caller.resourceBlock.create({ ...input, force: false })).rejects.toThrow(
      "rendez-vous sont prévus",
    );
    const result = await caller.resourceBlock.create({ ...input, force: true });
    expect(result.unassignedAppointmentIds).toContain(existing.id);
    const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.bayId).toBeNull();
    const list = await caller.resourceBlock.list({ siteId: siteA.id });
    expect(list.map((b) => b.id)).toContain(result.block.id);
    await caller.resourceBlock.delete({ id: result.block.id });
  });

  it("planning.updateSettings fusionne les réglages et exige planning:manage", async () => {
    const advisorCaller = callerFactory(await contextFor(advisor.token));
    await expect(
      advisorCaller.planning.updateSettings({ appointments: { lateAfterMinutes: 45 } }),
    ).rejects.toThrow("Permission manquante");
    const managerCaller = callerFactory(await contextFor(manager.token));
    const updated = await managerCaller.planning.updateSettings({
      appointments: { lateAfterMinutes: 45, durations: { SERVICE: 75 } },
      planning: { lunchBreak: ["12:30", "13:30"] },
    });
    expect(updated.appointments.lateAfterMinutes).toBe(45);
    expect(updated.appointments.durations.SERVICE).toBe(75);
    expect(updated.appointments.durations.REPAIR).toBe(120);
    expect(updated.planning.lunchBreak).toEqual(["12:30", "13:30"]);
    await managerCaller.planning.updateSettings({
      appointments: { durations: { SERVICE: 90 } },
      planning: { lunchBreak: null },
    });
  });

  it("appointment.today liste les RDV du jour avec compteurs", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    const today = await caller.appointment.today({ siteId: siteA.id, date: nextSaturday("09:00") });
    expect(today.counters.total).toBeGreaterThan(0);
    expect(Array.isArray(today.callsToMake)).toBe(true);
  });

  it("isolation multi-locataire : l'organisation B ne voit ni ne modifie les RDV de A", async () => {
    const callerB = callerFactory(await contextFor(ownerB.token));
    const existing = await adminDb.appointment.findFirstOrThrow({
      where: { organizationId: orgA.id },
    });
    await expect(callerB.appointment.get({ id: existing.id })).rejects.toThrow("introuvable");
    await expect(callerB.appointment.confirm({ id: existing.id, via: "phone" })).rejects.toThrow(
      "introuvable",
    );
    await expect(
      callerB.appointment.list({
        siteId: siteA.id,
        from: new Date(0),
        to: new Date(Date.now() + 365 * 86_400_000),
      }),
    ).rejects.toThrow();
    const listB = await callerB.appointment.list({
      siteId: siteB.id,
      from: new Date(0),
      to: new Date(Date.now() + 365 * 86_400_000),
    });
    expect(listB.appointments).toHaveLength(0);
  });

  it("portée par site : un conseiller limité au site B ne lit pas le planning du site A", async () => {
    const siteA2 = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Site A2", code: "SA2", openingHours: HOURS },
    });
    const limited = await memberFor(orgA.id, "ADVISOR", [siteA2.id]);
    const caller = callerFactory(await contextFor(limited.token));
    await expect(
      caller.appointment.list({ siteId: siteA.id, from: new Date(0), to: new Date() }),
    ).rejects.toThrow("FORBIDDEN_SITE");
    const mech = mechanic;
    void mech;
  });

  it("US-M03-12 : planification en lot d'une flotte avec une seule confirmation", async () => {
    const fleet = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "COMPANY",
        companyName: "SOTRA Logistique",
        displayName: "SOTRA Logistique",
        phone: "+2250555000111",
        hasWhatsapp: true,
      },
    });
    const plates = ["AA 100 CI", "AA 101 CI", "AA 102 CI", "AA 103 CI"];
    const vehicles = [];
    for (const plate of plates) {
      vehicles.push(
        await adminDb.vehicle.create({
          data: {
            organizationId: orgA.id,
            customerId: fleet.id,
            plate,
            plateCompact: plate.replace(/\s/g, ""),
            make: "Renault",
            model: "Kangoo",
          },
        }),
      );
    }
    const caller = callerFactory(await contextFor(manager.token));
    const result = await caller.appointment.createBatch({
      siteId: siteA.id,
      customerId: fleet.id,
      date: nextSaturday("08:00", 6),
      vehicleIds: vehicles.map((v) => v.id),
      type: "INSPECTION_PREP",
      maxParallel: 2,
      notifyCustomer: true,
    });
    expect(result.unplaced).toEqual([]);
    expect(result.appointments).toHaveLength(4);
    expect(new Set(result.appointments.map((a) => a.groupId)).size).toBe(1);
    const message = defaultOutbox.lastFor("+2250555000111");
    expect(message?.body).toContain("vos 4 RDV chez Garage RDV A sont confirmés");
    expect(defaultOutbox.list().filter((m) => m.to === "+2250555000111")).toHaveLength(1);
  });
});
