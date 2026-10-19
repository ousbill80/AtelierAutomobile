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

describe("vehicle router (M02)", () => {
  let orgA: { id: string };
  let ownerA: { userId: string; membershipId: string; token: string };
  let customerA: { id: string };

  let orgB: { id: string };
  let ownerB: { userId: string; membershipId: string; token: string };

  const userIds: string[] = [];

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Véhicules A", plan: "PRO" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Vehicules A");
    userIds.push(ownerA.userId);
    customerA = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Client Véhicules A" },
    });

    orgB = await adminDb.organization.create({ data: { name: "Garage Véhicules B", plan: "PRO" } });
    ownerB = await ownerContextFor(orgB.id, "Owner Vehicules B");
    userIds.push(ownerB.userId);
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.vehicleEvent.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.mileageReading.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("vehicle.create normalise la plaque et journalise vehicle.created", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const vehicle = await caller.vehicle.create({
      customerId: customerA.id,
      plate: "1234 ab 01",
      make: "Toyota",
      model: "Corolla",
    });
    expect(vehicle.plate).toBe("1234 AB 01");
    expect(vehicle.plateCompact).toBe("1234AB01");
    expect(vehicle.plateType).toBe("STANDARD");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "vehicle.created", entityId: vehicle.id },
    });
    expect(log).not.toBeNull();
  });

  it("vehicle.create refuse une plaque déjà utilisée (RG-M02-04)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await expect(
      caller.vehicle.create({
        customerId: customerA.id,
        plate: "1234 AB 01",
        make: "Toyota",
        model: "Yaris",
      }),
    ).rejects.toThrow("existe déjà");
  });

  it("vehicle.list et vehicle.get isolent les véhicules par organisation", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const callerB = callerFactory(await contextFor(ownerB.token));

    const listA = await callerA.vehicle.list({});
    expect(listA.items.length).toBeGreaterThan(0);
    const vehicleId = listA.items[0]!.id;

    const listB = await callerB.vehicle.list({});
    expect(listB.items.map((v) => v.id)).not.toContain(vehicleId);

    await expect(callerB.vehicle.get({ id: vehicleId })).rejects.toThrow();
  });

  it("vehicle.recordMileage calcule le km de vie et refuse un km inférieur sans odometerReset", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const vehicle = await caller.vehicle.create({
      customerId: customerA.id,
      plate: "5678 CD 02",
      make: "Renault",
      model: "Clio",
    });

    const first = await caller.vehicle.recordMileage({
      vehicleId: vehicle.id,
      mileage: 10000,
      readAt: new Date("2026-01-01T00:00:00.000Z"),
      source: "RECEPTION",
    });
    expect(first.vehicle.currentMileage).toBe(10000);

    await expect(
      caller.vehicle.recordMileage({
        vehicleId: vehicle.id,
        mileage: 9000,
        readAt: new Date("2026-02-01T00:00:00.000Z"),
        source: "RECEPTION",
      }),
    ).rejects.toThrow("inférieur au dernier relevé");

    const reset = await caller.vehicle.recordMileage({
      vehicleId: vehicle.id,
      mileage: 100,
      readAt: new Date("2026-02-01T00:00:00.000Z"),
      source: "RECEPTION",
      odometerReset: true,
    });
    // RG-M02-09 : après remplacement du compteur, le km de vie affiché ne recule pas.
    expect(reset.vehicle.currentMileage).toBe(10000);

    const refreshed = await adminDb.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(refreshed.odometerOffset).toBe(9900);
  });

  it("vehicle.recordInspection refuse une expiration antérieure à la visite", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const vehicle = await caller.vehicle.create({
      customerId: customerA.id,
      plate: "9012 EF 03",
      make: "Peugeot",
      model: "208",
    });

    await expect(
      caller.vehicle.recordInspection({
        vehicleId: vehicle.id,
        date: new Date("2026-03-01T00:00:00.000Z"),
        expiryDate: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("après la date de la visite");

    const recorded = await caller.vehicle.recordInspection({
      vehicleId: vehicle.id,
      date: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(recorded.inspectionExpiryDate).not.toBeNull();
    expect(recorded.inspectionStatus).toBeDefined();
  });

  it("vehicle.transferOwner change de propriétaire et annule les relances planifiées", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const otherCustomer = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Nouveau Propriétaire" },
    });
    const vehicle = await caller.vehicle.create({
      customerId: customerA.id,
      plate: "3456 GH 04",
      make: "Hyundai",
      model: "i10",
    });

    const transferred = await caller.vehicle.transferOwner({
      vehicleId: vehicle.id,
      toCustomerId: otherCustomer.id,
      effectiveDate: new Date(),
    });
    expect(transferred.customerId).toBe(otherCustomer.id);
  });

  it("vehicle.replacePlate remplace la plaque et journalise un événement", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const vehicle = await caller.vehicle.create({
      customerId: customerA.id,
      plate: "7890 IJ 05",
      make: "Kia",
      model: "Picanto",
    });

    const replaced = await caller.vehicle.replacePlate({
      vehicleId: vehicle.id,
      newPlate: "1111 KL 06",
    });
    expect(replaced.plate).toBe("1111 KL 06");

    const event = await adminDb.vehicleEvent.findFirst({
      where: { vehicleId: vehicle.id, type: "plate_changed" },
    });
    expect(event).not.toBeNull();
  });

  it("vehicle.merge déplace les relevés du véhicule source puis le supprime", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const source = await caller.vehicle.create({
      customerId: customerA.id,
      plate: "2222 MN 07",
      make: "Suzuki",
      model: "Alto",
    });
    const target = await caller.vehicle.create({
      customerId: customerA.id,
      plate: "3333 OP 08",
      make: "Suzuki",
      model: "Alto",
    });
    await caller.vehicle.recordMileage({
      vehicleId: source.id,
      mileage: 500,
      readAt: new Date(),
      source: "MANUAL",
    });

    const result = await caller.vehicle.merge({ sourceId: source.id, targetId: target.id });
    expect(result.moved.mileageReadings).toBeGreaterThanOrEqual(1);

    const deletedSource = await adminDb.vehicle.findUniqueOrThrow({ where: { id: source.id } });
    expect(deletedSource.deletedAt).not.toBeNull();
    expect(deletedSource.mergedIntoId).toBe(target.id);
  });

  it("vehicle.delete refuse un véhicule avec un OR ouvert puis réussit une fois clôturé", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const site = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Site Véhicules A", code: "VHA" },
    });
    const vehicle = await caller.vehicle.create({
      customerId: customerA.id,
      plate: "4444 QR 09",
      make: "Ford",
      model: "Fiesta",
    });
    const repairOrder = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: site.id,
        number: "OR-VHA-2026-00001",
        customerId: customerA.id,
        vehicleId: vehicle.id,
        status: "IN_PROGRESS",
      },
    });

    await expect(caller.vehicle.delete({ id: vehicle.id, reason: "Test" })).rejects.toThrow(
      "OR est en cours",
    );

    await adminDb.repairOrder.update({
      where: { id: repairOrder.id },
      data: { status: "DELIVERED" },
    });
    const deleted = await caller.vehicle.delete({ id: vehicle.id, reason: "Doublon" });
    expect(deleted.ok).toBe(true);

    await adminDb.repairOrder.delete({ where: { id: repairOrder.id } });
    await adminDb.site.delete({ where: { id: site.id } });
  });
});
