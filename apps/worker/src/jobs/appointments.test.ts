import { randomBytes } from "node:crypto";
import { fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleAppointmentEvent,
  processDailyAgendaJob,
  processMarkNoShowJob,
  processUnconfirmedCheckJob,
} from "./appointments";

// M03 §12 — intégration worker : NO_SHOW automatique (20:00 locale), OR livré → COMPLETED,
// réponses 1/2/3, agenda du jour et confirmations à obtenir.

describe("appointments jobs (M03)", () => {
  let org: { id: string };
  let site: { id: string };
  let customer: { id: string };
  let advisor: { id: string; userId: string };
  const day = "2031-03-15"; // samedi, lointain : aucun autre test n'y pose de RDV
  const at = (hhmm: string, d = day) => new Date(`${d}T${hhmm}:00.000Z`);

  beforeAll(async () => {
    org = await adminDb.organization.create({
      data: { name: `Garage M03 worker ${randomBytes(3).toString("hex")}` },
    });
    site = await adminDb.site.create({
      data: { organizationId: org.id, name: "YOP", code: "YOP" },
    });
    customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Kouassi Jean-Marc", phone: "+2250701020304" },
    });
    const user = await adminDb.user.create({
      data: { name: "Conseiller", email: `w-${randomBytes(4).toString("hex")}@example.com` },
    });
    const m = await adminDb.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "ADVISOR", siteIds: [] },
    });
    advisor = { id: m.id, userId: user.id };
  });

  afterAll(async () => {
    const where = { organizationId: org.id };
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.appointment.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: advisor.userId } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  async function appointment(
    startsAt: Date,
    status: "BOOKED" | "CONFIRMED" | "ARRIVED" = "BOOKED",
  ) {
    return adminDb.appointment.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        customerId: customer.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        type: "SERVICE",
        status,
      },
    });
  }

  it("RG-M03-10 — NO_SHOW automatique à 20:00 heure locale seulement, idempotent", async () => {
    const a = await appointment(at("09:00"));
    await processMarkNoShowJob(fixedClock(at("19:45")), { organizationIds: [org.id] });
    expect((await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "BOOKED",
    );
    await processMarkNoShowJob(fixedClock(at("20:00")), { organizationIds: [org.id] });
    const after = await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("NO_SHOW");
    expect(after.noShowAt).toEqual(at("20:00"));
    await processMarkNoShowJob(fixedClock(at("20:15")), { organizationIds: [org.id] });
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: org.id, type: "appointment.no_show" },
      }),
    ).toBe(1);
  });

  it("repair_order.created puis status_changed DELIVERED → RDV ARRIVED puis COMPLETED", async () => {
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        plate: "2547 GH 01",
        plateCompact: "2547GH01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    const a = await appointment(at("10:00", "2031-03-17"));
    const order = await adminDb.repairOrder.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        number: `OR-YOP-2031-${randomBytes(2).toString("hex")}`,
        customerId: customer.id,
        vehicleId: vehicle.id,
        appointmentId: a.id,
      },
    });
    // OR brouillon préparé depuis le RDV : lien posé, mais pas d'arrivée.
    await handleAppointmentEvent(
      {
        id: "e0",
        organizationId: org.id,
        type: "repair_order.created",
        payload: { repairOrderId: order.id, appointmentId: a.id, status: "DRAFT" },
      },
      at("09:00", "2031-03-17"),
    );
    expect(await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: "BOOKED",
      repairOrderId: order.id,
    });
    const event = {
      id: "e1",
      organizationId: org.id,
      type: "repair_order.created",
      payload: { repairOrderId: order.id, appointmentId: a.id, status: "CHECKED_IN" },
    };
    await handleAppointmentEvent(event, at("10:05", "2031-03-17"));
    expect(await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: "ARRIVED",
      repairOrderId: order.id,
    });
    await handleAppointmentEvent(
      {
        ...event,
        type: "repair_order.status_changed",
        payload: { repairOrderId: order.id, newStatus: "IN_PROGRESS" },
      },
      at("11:00", "2031-03-17"),
    );
    expect((await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "ARRIVED",
    );
    await handleAppointmentEvent(
      {
        ...event,
        type: "repair_order.status_changed",
        payload: { repairOrderId: order.id, newStatus: "DELIVERED" },
      },
      at("17:00", "2031-03-17"),
    );
    expect((await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "COMPLETED",
    );
  });

  async function replyTo(appointmentId: string, body: string, now: Date) {
    await adminDb.message.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        direction: "OUTBOUND",
        channel: "SMS",
        to: "+2250701020304",
        body: "Votre RDV…",
        provider: "console",
        kind: "TRANSACTIONAL",
        idempotencyKey: `appt:${appointmentId}:confirm:${randomBytes(3).toString("hex")}`,
        createdAt: new Date(now.getTime() - 3_600_000),
      },
    });
    const inbound = await adminDb.message.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        direction: "INBOUND",
        channel: "WHATSAPP",
        to: "garage",
        body,
        provider: "console",
        kind: "CONVERSATION",
      },
    });
    await handleAppointmentEvent(
      {
        id: inbound.id,
        organizationId: org.id,
        type: "message.inbound_received",
        payload: { customerId: customer.id, messageId: inbound.id, stop: false },
      },
      now,
    );
  }

  it("US-M03-07 — « 1 » confirme (whatsapp), « 3 » annule (CUSTOMER), texte libre → à replanifier", async () => {
    const now = new Date();
    const a = await appointment(new Date(now.getTime() + 86_400_000));
    await replyTo(a.id, "1", now);
    expect(await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: "CONFIRMED",
      confirmedVia: "whatsapp",
    });
    await replyTo(a.id, "je peux pas demain", now);
    expect((await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "CONFIRMED",
    );
    expect(
      await adminDb.notification.count({
        where: { organizationId: org.id, type: "appointment.to_reschedule" },
      }),
    ).toBe(1);
    await replyTo(a.id, "3", now);
    expect(await adminDb.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: "CANCELLED",
      cancelledBy: "CUSTOMER",
    });
    expect(
      await adminDb.notification.count({
        where: { organizationId: org.id, type: "appointment.cancelled_by_customer" },
      }),
    ).toBe(1);
  });

  it("Relecture — « 1 » en réponse à une confirmation groupée confirme tout le groupe", async () => {
    const now = new Date();
    const groupId = `grp-${randomBytes(3).toString("hex")}`;
    const start = new Date(now.getTime() + 2 * 86_400_000);
    const ids = [];
    for (const offset of [0, 3_600_000]) {
      const a = await adminDb.appointment.create({
        data: {
          organizationId: org.id,
          siteId: site.id,
          customerId: customer.id,
          startsAt: new Date(start.getTime() + offset),
          endsAt: new Date(start.getTime() + offset + 3_600_000),
          type: "INSPECTION_PREP",
          groupId,
        },
      });
      ids.push(a.id);
    }
    await adminDb.message.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        direction: "OUTBOUND",
        channel: "SMS",
        to: "+2250701020304",
        body: "2 RDV…",
        provider: "console",
        kind: "TRANSACTIONAL",
        idempotencyKey: `appt:${groupId}:batch:2031-01-01`,
        createdAt: new Date(now.getTime() - 60_000),
      },
    });
    const inbound = await adminDb.message.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        direction: "INBOUND",
        channel: "SMS",
        to: "garage",
        body: "1",
        provider: "console",
        kind: "CONVERSATION",
      },
    });
    await handleAppointmentEvent(
      {
        id: inbound.id,
        organizationId: org.id,
        type: "message.inbound_received",
        payload: { customerId: customer.id, messageId: inbound.id },
      },
      now,
    );
    const rows = await adminDb.appointment.findMany({ where: { id: { in: ids } } });
    expect(rows.map((r) => r.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
  });

  it("agenda du jour à 07:00 et appels à passer à 18:00, une fois par jour", async () => {
    await appointment(at("09:00", "2031-03-18"));
    await appointment(at("08:00", "2031-03-19"));
    await processDailyAgendaJob(fixedClock(at("06:45", "2031-03-18")), {
      organizationIds: [org.id],
    });
    expect(
      await adminDb.notification.count({
        where: { organizationId: org.id, type: "appointments.daily_agenda" },
      }),
    ).toBe(0);
    await processDailyAgendaJob(fixedClock(at("07:00", "2031-03-18")), {
      organizationIds: [org.id],
    });
    await processDailyAgendaJob(fixedClock(at("07:15", "2031-03-18")), {
      organizationIds: [org.id],
    });
    expect(
      await adminDb.notification.count({
        where: { organizationId: org.id, type: "appointments.daily_agenda" },
      }),
    ).toBe(1);
    await processUnconfirmedCheckJob(fixedClock(at("18:00", "2031-03-18")), {
      organizationIds: [org.id],
    });
    const call = await adminDb.notification.findFirstOrThrow({
      where: { organizationId: org.id, type: "appointments.unconfirmed_check" },
    });
    expect(call.title).toContain("1 RDV de demain sans confirmation");
  });
});
