import { randomBytes } from "node:crypto";
import {
  addDaysToKey,
  computeSessionAbsoluteExpiry,
  localDateKey,
  zonedInstant,
} from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";
import { resetPortalRateLimit } from "./portal";

// M03 §12 — intégration : règles de réservation, cycle de vie, messages, portail, isolation.

const callerFactory = createCallerFactory(appRouter);
const TZ = "Africa/Abidjan";

async function contextFor(token: string, ip = "10.0.0.1") {
  const req = new Request("http://localhost/api/trpc", {
    headers: token
      ? { cookie: `atelieros_session=${token}`, "x-forwarded-for": ip }
      : { "x-forwarded-for": ip },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

type Role = "OWNER" | "MANAGER" | "ADVISOR" | "MECHANIC" | "CASHIER";

async function member(
  organizationId: string,
  role: Role,
  siteIds: string[] = [],
  name: string = role,
) {
  const user = await adminDb.user.create({
    data: { name, email: `m03-${randomBytes(4).toString("hex")}@example.com` },
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
  return {
    membershipId: membership.id,
    userId: user.id,
    caller: callerFactory(await contextFor(token)),
  };
}

/** Prochain samedi à au moins 7 jours (jamais dans le passé, quelle que soit la date du test). */
function nextSaturday(): string {
  let day = addDaysToKey(localDateKey(new Date(), TZ), 7);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== 6) day = addDaysToKey(day, 1);
  return day;
}
const at = (day: string, hhmm: string) =>
  zonedInstant(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);

function domainCode(error: unknown): string | undefined {
  const cause = (error as TRPCError).cause as { code?: string } | undefined;
  return cause?.code;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `attendu ${code}`).toBeInstanceOf(TRPCError);
  expect(domainCode(error)).toBe(code);
  return error as TRPCError;
}

const HOURS = {
  mon: [["07:30", "18:00"]],
  tue: [["07:30", "18:00"]],
  wed: [["07:30", "18:00"]],
  thu: [["07:30", "18:00"]],
  fri: [["07:30", "18:00"]],
  sat: [["08:00", "14:00"]],
  sun: [],
};

describe("appointment / planning / portal routers (M03)", () => {
  const SAT = nextSaturday();
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let orgA: { id: string };
  let siteYop: { id: string };
  let siteCoc: { id: string };
  let pont1: { id: string };
  let pont2: { id: string };
  let diag: { id: string };
  let owner: Awaited<ReturnType<typeof member>>;
  let manager: Awaited<ReturnType<typeof member>>;
  let advisorYop: Awaited<ReturnType<typeof member>>;
  let cashier: Awaited<ReturnType<typeof member>>;
  let ownerB: Awaited<ReturnType<typeof member>>;
  let kouassi: { id: string };
  let corolla: { id: string };
  let bamba: { id: string };
  let bambaCar: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({
      data: {
        name: "Garage Excellence Auto",
        phone: "+2250708123456",
        onboardingCompletedAt: new Date(),
      },
    });
    const orgB = await adminDb.organization.create({
      data: { name: "Garage M03 B", onboardingCompletedAt: new Date() },
    });
    orgIds.push(orgA.id, orgB.id);
    siteYop = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Atelier Yopougon", code: "YOP", openingHours: HOURS },
    });
    siteCoc = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Atelier Cocody", code: "COC", openingHours: HOURS },
    });
    await adminDb.site.create({
      data: { organizationId: orgB.id, name: "Site B", code: "BBB", openingHours: HOURS },
    });
    pont1 = await adminDb.bay.create({
      data: {
        organizationId: orgA.id,
        siteId: siteYop.id,
        name: "Pont 1",
        type: "LIFT",
        sortOrder: 1,
      },
    });
    pont2 = await adminDb.bay.create({
      data: {
        organizationId: orgA.id,
        siteId: siteYop.id,
        name: "Pont 2",
        type: "LIFT",
        sortOrder: 2,
      },
    });
    diag = await adminDb.bay.create({
      data: {
        organizationId: orgA.id,
        siteId: siteYop.id,
        name: "Diagnostic",
        type: "DIAGNOSTIC",
        sortOrder: 3,
      },
    });
    // WhatsApp hors fenêtre 24 h exige un modèle approuvé (RG-M11-10) : le texte libre part en SMS.
    await adminDb.channelConfig.createMany({
      data: [
        {
          organizationId: orgA.id,
          channel: "WHATSAPP",
          provider: "console",
          isActive: true,
          priority: 1,
          credentials: "",
        },
        {
          organizationId: orgA.id,
          channel: "SMS",
          provider: "console",
          isActive: true,
          priority: 1,
          credentials: "",
        },
      ],
    });
    owner = await member(orgA.id, "OWNER");
    manager = await member(orgA.id, "MANAGER");
    advisorYop = await member(orgA.id, "ADVISOR", [siteYop.id]);
    cashier = await member(orgA.id, "CASHIER");
    ownerB = await member(orgB.id, "OWNER");
    for (const m of [owner, manager, advisorYop, cashier, ownerB]) userIds.push(m.userId);

    kouassi = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Kouassi Jean-Marc",
        lastName: "Kouassi",
        civility: "M",
        phone: "+2250701020304",
      },
    });
    corolla = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: kouassi.id,
        plate: "2547 GH 01",
        plateCompact: "2547GH01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    bamba = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Bamba Aminata", phone: "+2250505050505" },
    });
    bambaCar = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: bamba.id,
        plate: "1234 AB 01",
        plateCompact: "1234AB01",
        make: "Kia",
        model: "Picanto",
      },
    });
  });

  beforeEach(() => resetPortalRateLimit());

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await adminDb.messageAttempt.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.portalToken.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.aiInteraction.deleteMany({ where });
    await adminDb.resourceBlock.deleteMany({ where });
    await adminDb.appointment.deleteMany({ where });
    await adminDb.reminder.deleteMany({ where });
    await adminDb.reminderRule.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.channelConfig.deleteMany({ where });
    await adminDb.bay.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("US-M03-01 — crée un RDV révision 09:00-10:30 sur le Pont 1 et envoie la confirmation", async () => {
    const { appointment, notified } = await advisorYop.caller.appointment.create({
      siteId: siteYop.id,
      customerId: kouassi.id,
      vehicleId: corolla.id,
      type: "SERVICE",
      startsAt: at(SAT, "09:00"),
      bayId: pont1.id,
      source: "PHONE",
    });
    expect(appointment.status).toBe("BOOKED");
    expect(appointment.durationMinutes).toBe(90);
    expect(appointment.endsAt).toEqual(at(SAT, "10:30"));
    expect(notified).toBe(true);
    const message = await adminDb.message.findFirstOrThrow({
      where: { idempotencyKey: { startsWith: `appt:${appointment.id}:confirm` } },
    });
    expect(message.kind).toBe("TRANSACTIONAL");
    expect(message.body).toContain(
      "Bonjour M. Kouassi, votre RDV chez Garage Excellence Auto est confirmé le samedi",
    );
    expect(message.body).toContain("à 09:00 pour la révision de votre Toyota Corolla (2547 GH 01)");
    expect(message.body).toMatch(/\/p\/[\w-]+\/rdv/);
    const event = await adminDb.domainEvent.findFirst({
      where: { organizationId: orgA.id, type: "appointment.created" },
    });
    expect((event?.payload as { appointmentId?: string }).appointmentId).toBe(appointment.id);
  });

  it("RG-M03-02 — refuse un chevauchement sur le même pont avec le nom du RDV en conflit ; bord à bord accepté", async () => {
    const error = await expectCode(
      advisorYop.caller.appointment.create({
        siteId: siteYop.id,
        customerId: bamba.id,
        vehicleId: bambaCar.id,
        type: "REPAIR",
        startsAt: at(SAT, "10:00"),
        bayId: pont1.id,
      }),
      "SLOT_CONFLICT",
    );
    expect(error.message).toBe("Pont 1 occupé de 09:00 à 10:30 (Kouassi Jean-Marc).");
    const { appointment } = await advisorYop.caller.appointment.create({
      siteId: siteYop.id,
      customerId: bamba.id,
      vehicleId: bambaCar.id,
      type: "SERVICE",
      startsAt: at(SAT, "10:30"),
      bayId: pont1.id,
      notifyCustomer: false,
    });
    expect(appointment.startsAt).toEqual(at(SAT, "10:30"));
  });

  it("RG-M03-02 — surréservation : forçage réservé à planning:manage, marqué et tracé", async () => {
    await expectCode(
      advisorYop.caller.appointment.create({
        siteId: siteYop.id,
        customerId: bamba.id,
        type: "OTHER",
        startsAt: at(SAT, "09:00"),
        bayId: pont1.id,
        force: true,
        notifyCustomer: false,
      }),
      "SLOT_CONFLICT",
    );
    const { appointment } = await manager.caller.appointment.create({
      siteId: siteYop.id,
      customerId: bamba.id,
      type: "OTHER",
      startsAt: at(SAT, "09:00"),
      bayId: pont1.id,
      force: true,
      notifyCustomer: false,
    });
    expect(appointment.overbooked).toBe(true);
    const log = await adminDb.auditLog.findFirst({
      where: { entityId: appointment.id, action: "appointment.forced" },
    });
    expect(log?.reason).toBeTruthy();
    await manager.caller.appointment.cancel({
      id: appointment.id,
      cancelledBy: "GARAGE",
      reasonCode: "DUPLICATE",
      notifyCustomer: false,
    });
  });

  it("RG-M03-01 — hors horaires (dimanche, samedi après 14:00) refusé, forçable par le MANAGER", async () => {
    const sunday = addDaysToKey(SAT, 1);
    await expectCode(
      advisorYop.caller.appointment.create({
        siteId: siteYop.id,
        customerId: bamba.id,
        type: "OTHER",
        startsAt: at(sunday, "09:00"),
      }),
      "OUTSIDE_OPENING_HOURS",
    );
    await expectCode(
      advisorYop.caller.appointment.create({
        siteId: siteYop.id,
        customerId: bamba.id,
        type: "SERVICE",
        startsAt: at(SAT, "13:00"),
      }),
      "OUTSIDE_OPENING_HOURS",
    );
    const { appointment } = await manager.caller.appointment.create({
      siteId: siteYop.id,
      customerId: bamba.id,
      type: "OTHER",
      startsAt: at(sunday, "09:00"),
      force: true,
      notifyCustomer: false,
    });
    expect(appointment.outsideHours).toBe(true);
    await manager.caller.appointment.cancel({
      id: appointment.id,
      cancelledBy: "GARAGE",
      reasonCode: "OTHER",
      reason: "Test",
      notifyCustomer: false,
    });
  });

  it("RG-M03-13 — second RDV du même véhicule le même jour : DUPLICATE_SAME_DAY (forçable)", async () => {
    const error = await expectCode(
      advisorYop.caller.appointment.create({
        siteId: siteYop.id,
        customerId: kouassi.id,
        vehicleId: corolla.id,
        type: "DIAGNOSTIC",
        startsAt: at(SAT, "12:00"),
        bayId: diag.id,
      }),
      "DUPLICATE_SAME_DAY",
    );
    expect(error.message).toMatch(
      /Ce véhicule a déjà un RDV le \d\d\/\d\d à 09:00\. Voulez-vous le modifier \?/,
    );
  });

  it("US-M03-03 — déplacement Pont 1 09:00 → Pont 2 11:00 avec message « déplacé »", async () => {
    const appt = await adminDb.appointment.findFirstOrThrow({
      where: { customerId: kouassi.id, status: "BOOKED" },
    });
    const { appointment, notified } = await manager.caller.appointment.update({
      id: appt.id,
      bayId: pont2.id,
      startsAt: at(SAT, "11:00"),
    });
    expect(appointment.bayId).toBe(pont2.id);
    expect(appointment.endsAt).toEqual(at(SAT, "12:30"));
    expect(notified).toBe(true);
    const moved = await adminDb.message.findFirstOrThrow({
      where: { idempotencyKey: { startsWith: `appt:${appt.id}:moved` } },
    });
    expect(moved.body).toContain("votre RDV a été déplacé au samedi");
    expect(moved.body).toContain("à 11:00");
    // Redimensionnement par pas de 15 min, sans message (même heure de début).
    const resized = await manager.caller.appointment.update({ id: appt.id, durationMinutes: 105 });
    expect(resized.appointment.endsAt).toEqual(at(SAT, "12:45"));
    expect(resized.notified).toBe(false);
  });

  it("Contrainte d'exclusion Postgres : deux insertions concurrentes sur le même pont", async () => {
    const base = {
      organizationId: orgA.id,
      siteId: siteYop.id,
      customerId: bamba.id,
      bayId: diag.id,
      type: "DIAGNOSTIC" as const,
      startsAt: at(SAT, "08:00"),
      endsAt: at(SAT, "09:00"),
    };
    const results = await Promise.allSettled([
      adminDb.appointment.create({ data: base }),
      adminDb.appointment.create({ data: base }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("appointment_no_overlap");
    // Surréservée ou annulée : la contrainte ne s'applique pas.
    await adminDb.appointment.create({ data: { ...base, overbooked: true } });
    await adminDb.appointment.create({ data: { ...base, status: "CANCELLED" } });
    await adminDb.appointment.deleteMany({ where: { bayId: diag.id } });
  });

  it("US-M03-02 — « Trouver un créneau » : 10 créneaux DIAGNOSTIC sur le pont Diagnostic", async () => {
    const result = await advisorYop.caller.planning.availableSlots({
      siteId: siteYop.id,
      type: "DIAGNOSTIC",
      from: at(SAT, "00:00"),
      days: 7,
    });
    const slots = result.groups.flatMap((g) => g.slots);
    expect(slots).toHaveLength(10);
    expect(slots.every((s) => s.bayId === diag.id)).toBe(true);
    expect(slots[0]!.startsAt).toEqual(at(SAT, "08:00"));
  });

  it("RG-M03-05 — capacité : demi-journée pleine refusée (2 mécaniciens), forçable", async () => {
    const mech1 = await member(orgA.id, "MECHANIC", [siteYop.id], "Drissa");
    userIds.push(mech1.userId);
    const day = addDaysToKey(SAT, 2); // lundi 07:30-13:00 = 330 min × 0,85 = 280 min
    await advisorYop.caller.appointment.create({
      siteId: siteYop.id,
      customerId: bamba.id,
      type: "REPAIR",
      startsAt: at(day, "08:00"),
      bayId: pont1.id,
      durationMinutes: 240,
      notifyCustomer: false,
    });
    const error = await expectCode(
      advisorYop.caller.appointment.create({
        siteId: siteYop.id,
        customerId: kouassi.id,
        type: "SERVICE",
        startsAt: at(day, "08:00"),
        bayId: pont2.id,
      }),
      "CAPACITY_EXCEEDED",
    );
    expect(error.message).toMatch(/^Atelier complet lundi matin \(5 h 30 \/ 4 h 40\)\.$/);
    const capacity = await advisorYop.caller.planning.capacity({
      siteId: siteYop.id,
      from: day,
      to: day,
    });
    expect(capacity[0]).toMatchObject({
      halfDay: "AM",
      capacityMinutes: 280,
      loadMinutes: 240,
      appointmentsCount: 1,
    });
    // RG-M03-06 / US-M03-04 : mécanicien absent → affectation refusée.
    await manager.caller.resourceBlock.create({
      siteId: siteYop.id,
      membershipId: mech1.membershipId,
      startsAt: at(day, "13:00"),
      endsAt: at(day, "18:00"),
      reason: "Congé",
    });
    await expectCode(
      manager.caller.appointment.create({
        siteId: siteYop.id,
        customerId: kouassi.id,
        type: "OTHER",
        startsAt: at(day, "14:00"),
        mechanicId: mech1.membershipId,
      }),
      "MECHANIC_ABSENT",
    );
  });

  it("US-M03-10 — blocage d'un pont avec RDV en conflit : BLOCK_HAS_APPOINTMENTS, puis forçage → « À affecter »", async () => {
    const day = addDaysToKey(SAT, 3);
    const { appointment } = await advisorYop.caller.appointment.create({
      siteId: siteYop.id,
      customerId: bamba.id,
      type: "SERVICE",
      startsAt: at(day, "09:00"),
      bayId: pont2.id,
      notifyCustomer: false,
    });
    await expectCode(
      manager.caller.resourceBlock.create({
        siteId: siteYop.id,
        bayId: pont2.id,
        startsAt: at(day, "07:30"),
        endsAt: at(day, "18:00"),
        reason: "Maintenance pont",
      }),
      "BLOCK_HAS_APPOINTMENTS",
    );
    const { affectedIds } = await manager.caller.resourceBlock.create({
      siteId: siteYop.id,
      bayId: pont2.id,
      startsAt: at(day, "07:30"),
      endsAt: at(day, "18:00"),
      reason: "Maintenance pont",
      force: true,
    });
    expect(affectedIds).toEqual([appointment.id]);
    const after = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(after.bayId).toBeNull();
    await expectCode(
      advisorYop.caller.appointment.create({
        siteId: siteYop.id,
        customerId: kouassi.id,
        type: "SERVICE",
        startsAt: at(day, "14:00"),
        bayId: pont2.id,
      }),
      "SLOT_BLOCKED",
    );
    await expect(
      advisorYop.caller.resourceBlock.create({
        siteId: siteYop.id,
        bayId: pont1.id,
        startsAt: at(day, "07:30"),
        endsAt: at(day, "08:00"),
        reason: "x",
      }),
    ).rejects.toThrow(/planning:manage/);
  });

  it("Cycle de vie : confirmer, client arrivé (URL de réception M04), annulation interdite ensuite", async () => {
    const appt = await adminDb.appointment.findFirstOrThrow({
      where: { customerId: kouassi.id, vehicleId: corolla.id, status: "BOOKED" },
    });
    await advisorYop.caller.appointment.confirm({ id: appt.id, via: "phone" });
    const confirmed = await adminDb.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedVia).toBe("phone");
    const { receptionUrl } = await advisorYop.caller.appointment.markArrived({ id: appt.id });
    expect(receptionUrl).toBe(`/ordres/reception?appointmentId=${appt.id}`);
    await expectCode(
      advisorYop.caller.appointment.cancel({
        id: appt.id,
        cancelledBy: "CUSTOMER",
        notifyCustomer: false,
      }),
      "appointment.invalid_transition",
    );
    await advisorYop.caller.appointment.complete({ id: appt.id, reason: "Contrôle gratuit" });
    expect((await adminDb.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe(
      "COMPLETED",
    );
  });

  it("RG-M03-11 — annulation garage : motif obligatoire ; message « annulé » avec lien de reprogrammation", async () => {
    const day = addDaysToKey(SAT, 4);
    const { appointment } = await advisorYop.caller.appointment.create({
      siteId: siteYop.id,
      customerId: kouassi.id,
      vehicleId: corolla.id,
      type: "SERVICE",
      startsAt: at(day, "09:00"),
      notifyCustomer: false,
    });
    await expect(
      advisorYop.caller.appointment.cancel({ id: appointment.id, cancelledBy: "GARAGE" }),
    ).rejects.toThrow(/motif/);
    await advisorYop.caller.appointment.cancel({
      id: appointment.id,
      cancelledBy: "GARAGE",
      reasonCode: "PART_UNAVAILABLE",
    });
    const row = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(row).toMatchObject({
      status: "CANCELLED",
      cancelledBy: "GARAGE",
      cancelReason: "Pièce non disponible",
    });
    const msg = await adminDb.message.findFirstOrThrow({
      where: { idempotencyKey: { startsWith: `appt:${appointment.id}:cancelled` } },
    });
    expect(msg.body).toMatch(/est annulé\. Pour reprogrammer : http.*\/p\/[\w-]+\/rdv/);
  });

  it("RG-M03-10 — absent, correction ≤ 48 h avec motif, message de reprogrammation", async () => {
    const day = addDaysToKey(SAT, 5);
    const { appointment } = await advisorYop.caller.appointment.create({
      siteId: siteYop.id,
      customerId: bamba.id,
      vehicleId: bambaCar.id,
      type: "SERVICE",
      startsAt: at(day, "09:00"),
      notifyCustomer: false,
    });
    await advisorYop.caller.appointment.markNoShow({ id: appointment.id });
    const { messageId } = await advisorYop.caller.appointment.sendNoShowMessage({
      id: appointment.id,
    });
    const msg = await adminDb.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(msg.body).toContain(
      "nous ne vous avons pas vu aujourd'hui. Souhaitez-vous reprogrammer votre révision ?",
    );
    await expect(
      advisorYop.caller.appointment.revertNoShow({ id: appointment.id, reason: "" }),
    ).rejects.toThrow();
    await advisorYop.caller.appointment.revertNoShow({
      id: appointment.id,
      reason: "Client arrivé, non pointé",
    });
    expect(
      (await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status,
    ).toBe("ARRIVED");
    expect(
      await adminDb.auditLog.count({
        where: { entityId: appointment.id, action: "appointment.no_show_reverted" },
      }),
    ).toBe(1);
  });

  it("US-M03-06 / US-M03-07 — portail : confirmer par le lien, réserver depuis un lien de relance", async () => {
    const day = addDaysToKey(SAT, 7);
    const { appointment } = await advisorYop.caller.appointment.create({
      siteId: siteYop.id,
      customerId: kouassi.id,
      vehicleId: corolla.id,
      type: "SERVICE",
      startsAt: at(day, "09:00"),
    });
    const msg = await adminDb.message.findFirstOrThrow({
      where: { idempotencyKey: { startsWith: `appt:${appointment.id}:confirm` } },
    });
    const token = /\/p\/([\w-]+)\/rdv/.exec(msg.body)![1]!;
    const anonymous = callerFactory(await contextFor(""));
    const view = await anonymous.portal.appointment.get({ token });
    expect(view.kind).toBe("appointment");
    expect(JSON.stringify(view)).not.toContain("Bamba");
    await anonymous.portal.appointment.confirm({ token });
    const confirmed = await adminDb.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
    });
    expect(confirmed).toMatchObject({ status: "CONFIRMED", confirmedVia: "portal" });

    // Lien BOOKING issu d'une relance (reminderId) : source REMINDER, statut CONFIRMED.
    const rule = await adminDb.reminderRule.create({
      data: {
        organizationId: orgA.id,
        type: "INSPECTION",
        name: "VT",
        steps: [],
        sendWindow: {},
        stopOn: [],
      },
    });
    const reminder = await adminDb.reminder.create({
      data: {
        organizationId: orgA.id,
        ruleId: rule.id,
        type: "INSPECTION",
        stepKey: "J-30",
        customerId: bamba.id,
        vehicleId: bambaCar.id,
        dueDate: new Date(),
        scheduledFor: new Date(),
        status: "SENT",
        sentAt: new Date(),
        dedupeKey: `m03-${randomBytes(3).toString("hex")}`,
      },
    });
    const { issuePortalToken } = await import("@atelieros/db");
    const booking = await issuePortalToken(adminDb, {
      organizationId: orgA.id,
      scope: "BOOKING",
      targetId: bambaCar.id,
      customerId: bamba.id,
      reminderId: reminder.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const slots = await anonymous.portal.appointment.slots({
      token: booking.token,
      type: "INSPECTION_PREP",
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((g) => g.slots.length <= 6)).toBe(true);
    const chosen = slots[0]!.slots[0]!;
    const booked = await anonymous.portal.appointment.book({
      token: booking.token,
      startsAt: chosen,
      type: "INSPECTION_PREP",
    });
    expect(booked.status).toBe("CONFIRMED");
    const created = await adminDb.appointment.findFirstOrThrow({
      where: { customerId: bamba.id, reminderId: reminder.id },
    });
    expect(created.source).toBe("REMINDER");
    expect((await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).outcome).toBe(
      "APPOINTMENT_BOOKED",
    );
    // Lien expiré.
    await adminDb.portalToken.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(anonymous.portal.appointment.get({ token: booking.token })).rejects.toThrow(
      /expiré/,
    );
  });

  it("US-M03-12 — planification en lot : 4 véhicules, 2 en parallèle, une seule confirmation", async () => {
    const sotra = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "COMPANY",
        displayName: "SOTRA Logistique",
        phone: "+2250101010101",
      },
    });
    const vehicles = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        adminDb.vehicle.create({
          data: {
            organizationId: orgA.id,
            customerId: sotra.id,
            plate: `100${i} SO 01`,
            plateCompact: `100${i}SO01`,
            make: "Isuzu",
            model: "NPR",
          },
        }),
      ),
    );
    const day = addDaysToKey(SAT, 14);
    const result = await manager.caller.appointment.createBatch({
      siteId: siteYop.id,
      customerId: sotra.id,
      date: day,
      vehicleIds: vehicles.map((v) => v.id),
      type: "INSPECTION_PREP",
      maxParallel: 2,
    });
    expect(result.unplaced).toEqual([]);
    expect(result.appointments.map((a) => a.startsAt.toISOString().slice(11, 16))).toEqual([
      "08:00",
      "08:00",
      "09:00",
      "09:00",
    ]);
    expect(new Set(result.appointments.map((a) => a.groupId))).toEqual(new Set([result.groupId]));
    const messages = await adminDb.message.findMany({ where: { customerId: sotra.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain("4 RDV sont confirmés");
    await expect(
      advisorYop.caller.appointment.createBatch({
        siteId: siteYop.id,
        customerId: sotra.id,
        date: day,
        vehicleIds: [vehicles[0]!.id],
      }),
    ).rejects.toThrow(/planning:manage/);
  });

  it("Permissions : un CASHIER voit le planning mais ne crée pas de RDV", async () => {
    const list = await cashier.caller.appointment.list({
      siteId: siteYop.id,
      from: at(SAT, "00:00"),
      to: at(addDaysToKey(SAT, 1), "00:00"),
    });
    expect(list.appointments.length).toBeGreaterThan(0);
    await expect(
      cashier.caller.appointment.create({
        siteId: siteYop.id,
        customerId: kouassi.id,
        type: "OTHER",
        startsAt: at(SAT, "12:00"),
      }),
    ).rejects.toThrow(/appointment:create/);
  });

  it("Portée par site : un ADVISOR limité à YOP ne voit pas le planning COC", async () => {
    await expect(
      advisorYop.caller.appointment.list({
        siteId: siteCoc.id,
        from: at(SAT, "00:00"),
        to: at(addDaysToKey(SAT, 1), "00:00"),
      }),
    ).rejects.toThrow(/FORBIDDEN_SITE/);
    const cocAppt = await owner.caller.appointment.create({
      siteId: siteCoc.id,
      customerId: bamba.id,
      type: "OTHER",
      startsAt: at(SAT, "09:00"),
      notifyCustomer: false,
    });
    await expect(advisorYop.caller.appointment.get({ id: cocAppt.appointment.id })).rejects.toThrow(
      /FORBIDDEN_SITE/,
    );
  });

  it("Isolation multi-locataire : l'organisation B ne lit ni ne modifie les RDV de A", async () => {
    const appt = await adminDb.appointment.findFirstOrThrow({ where: { organizationId: orgA.id } });
    await expect(ownerB.caller.appointment.get({ id: appt.id })).rejects.toThrow(/introuvable/);
    await expect(ownerB.caller.appointment.confirm({ id: appt.id, via: "phone" })).rejects.toThrow(
      /introuvable/,
    );
    await expect(
      ownerB.caller.appointment.cancel({ id: appt.id, cancelledBy: "CUSTOMER" }),
    ).rejects.toThrow(/introuvable/);
    const listB = await ownerB.caller.appointment.list({
      from: at(SAT, "00:00"),
      to: at(addDaysToKey(SAT, 30), "00:00"),
    });
    expect(listB.appointments).toEqual([]);
    await expect(
      ownerB.caller.appointment.create({
        customerId: kouassi.id,
        type: "OTHER",
        startsAt: at(SAT, "09:00"),
      }),
    ).rejects.toThrow(/Client introuvable/);
    const blocks = await ownerB.caller.resourceBlock.list({
      from: at(SAT, "00:00"),
      to: at(addDaysToKey(SAT, 30), "00:00"),
    });
    expect(blocks).toEqual([]);
  });

  it("Paramètres planning : lecture des défauts, mise à jour réservée à planning:manage", async () => {
    const settings = await advisorYop.caller.planningSettings.get();
    expect(settings.appointments.durations.SERVICE).toBe(90);
    await expect(advisorYop.caller.planningSettings.update(settings)).rejects.toThrow(
      /planning:manage/,
    );
    const updated = await manager.caller.planningSettings.update({
      ...settings,
      appointments: { ...settings.appointments, lateAfterMinutes: 45 },
    });
    expect(updated.appointments.lateAfterMinutes).toBe(45);
  });

  it("US-M03-05 — suggestion de créneau depuis « oui samedi matin », journalisée dans AiInteraction", async () => {
    const result = await advisorYop.caller.planning.suggestSlot({
      customerId: kouassi.id,
      vehicleId: corolla.id,
      type: "INSPECTION_PREP",
      preferredText: "oui samedi matin",
    });
    expect(result.aiInteractionId).toBeTruthy();
    for (const s of result.suggestions) {
      expect(new Date(s.startsAt).getUTCDay()).toBe(6);
      expect(s.reason).toContain("samedi matin");
    }
  });
});
