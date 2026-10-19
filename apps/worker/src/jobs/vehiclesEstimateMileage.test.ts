import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processVehiclesEstimateMileageJob } from "./vehiclesEstimateMileage";

describe("vehicles.estimate_mileage — intégration (RG-M10-08)", () => {
  let org: { id: string };
  let customer: { id: string };
  let vehicle: { id: string };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Mileage Test" } });
    customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Client Kilométrage Test", type: "INDIVIDUAL" },
    });
    vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        plate: "8888 AB 01",
        make: "Toyota",
        model: "Corolla",
        usage: "PRIVATE",
        currentMileage: 48_200,
        currentMileageAt: new Date(Date.now() - 10 * 86_400_000),
        lastServiceDate: new Date("2026-04-15"),
        lastServiceMileage: 40_000,
        serviceIntervalKm: 10_000,
        serviceIntervalMonths: 12,
      },
    });
    await adminDb.mileageReading.createMany({
      data: [
        {
          organizationId: org.id,
          vehicleId: vehicle.id,
          mileage: 42_000,
          readAt: new Date(Date.now() - 100 * 86_400_000),
          source: "MANUAL",
        },
        {
          organizationId: org.id,
          vehicleId: vehicle.id,
          mileage: 48_200,
          readAt: new Date(Date.now() - 10 * 86_400_000),
          source: "MANUAL",
        },
      ],
    });
  });

  afterAll(async () => {
    await adminDb.mileageReading.deleteMany({ where: { organizationId: org.id } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("calcule avgKmPerDay et met à jour l'échéance de révision du véhicule", async () => {
    await processVehiclesEstimateMileageJob();

    const updated = await adminDb.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(updated.avgKmPerDay).toBeGreaterThan(0);
    expect(updated.estimatedMileage).not.toBeNull();
    expect(updated.nextServiceDueDate).not.toBeNull();
    expect(updated.nextServiceTrigger).toMatch(/DATE|MILEAGE/);
    expect(updated.serviceDueBasis).toMatch(/date|km/);
  });
});
