import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAppointmentsMarkNoShowJob } from "./appointmentsMarkNoShow";

describe("appointments.mark_no_show — intégration (RG-M03-10)", () => {
  let org: { id: string };
  let customer: { id: string };
  let vehicle: { id: string };
  let site: { id: string };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage No-Show Test" } });
    site = await adminDb.site.create({
      data: {
        organizationId: org.id,
        name: "Atelier",
        code: `NS${randomBytes(2).toString("hex")}`,
      },
    });
    customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Client No-Show Test", type: "INDIVIDUAL" },
    });
    vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        plate: "7777 AB 01",
        plateCompact: "7777AB01",
        make: "Toyota",
        model: "Corolla",
        usage: "PRIVATE",
      },
    });
    await adminDb.reminderSuppression.create({
      data: {
        organizationId: org.id,
        vehicleId: vehicle.id,
        type: "INSPECTION",
        until: new Date(Date.now() + 86_400_000),
        reason: "RDV pris",
        source: "appointment",
      },
    });
  });

  afterAll(async () => {
    await adminDb.reminderSuppression.deleteMany({ where: { organizationId: org.id } });
    await adminDb.appointment.deleteMany({ where: { organizationId: org.id } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.site.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("passe en NO_SHOW un RDV d'hier, quelle que soit l'heure, et reprend la séquence VT", async () => {
    const yesterday = await adminDb.appointment.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 23 * 60 * 60 * 1000),
        type: "SERVICE",
        status: "BOOKED",
      },
    });

    await processAppointmentsMarkNoShowJob(new Date());

    const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: yesterday.id } });
    expect(updated.status).toBe("NO_SHOW");
    expect(updated.noShowAt).not.toBeNull();

    const suppression = await adminDb.reminderSuppression.findFirst({
      where: { vehicleId: vehicle.id, source: "appointment" },
    });
    expect(suppression).toBeNull();

    const updatedCustomer = await adminDb.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(updatedCustomer.noShowCount12m).toBe(1);
  });

  it("ne touche pas un RDV du jour avant l'heure du job (20:00)", async () => {
    const todayNoonUtc = new Date(`${new Date().toISOString().slice(0, 10)}T10:00:00.000Z`);
    const today = await adminDb.appointment.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        startsAt: todayNoonUtc,
        endsAt: new Date(todayNoonUtc.getTime() + 60 * 60 * 1000),
        type: "SERVICE",
        status: "CONFIRMED",
      },
    });

    const beforeJobTime = new Date(`${new Date().toISOString().slice(0, 10)}T19:00:00.000Z`);
    await processAppointmentsMarkNoShowJob(beforeJobTime);

    const stillBooked = await adminDb.appointment.findUniqueOrThrow({ where: { id: today.id } });
    expect(stillBooked.status).toBe("CONFIRMED");

    const afterJobTime = new Date(`${new Date().toISOString().slice(0, 10)}T20:30:00.000Z`);
    await processAppointmentsMarkNoShowJob(afterJobTime);

    const nowNoShow = await adminDb.appointment.findUniqueOrThrow({ where: { id: today.id } });
    expect(nowNoShow.status).toBe("NO_SHOW");
  });
});
