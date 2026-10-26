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
  return { userId: user.id, token };
}

describe("vehicle router (M02)", () => {
  let org: { id: string };
  let owner: { userId: string; token: string };
  let customer: { id: string };
  let caller: ReturnType<typeof callerFactory>;

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Vehicle Test" } });
    owner = await ownerContextFor(org.id, "Owner Vehicle");
    customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Client Véhicule Test", type: "INDIVIDUAL" },
    });
    caller = callerFactory(await contextFor(owner.token));
  });

  afterAll(async () => {
    await adminDb.vehicleEvent.deleteMany({ where: { organizationId: org.id } });
    await adminDb.mileageReading.deleteMany({ where: { organizationId: org.id } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.site.deleteMany({ where: { organizationId: org.id } });
    await adminDb.session.deleteMany({ where: { userId: owner.userId } });
    await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    await adminDb.user.deleteMany({ where: { id: owner.userId } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("vehicle.create normalise la plaque (RG-M02-05)", async () => {
    const vehicle = await caller.vehicle.create({
      customerId: customer.id,
      plate: "2547gh01",
      make: "Toyota",
      model: "Corolla",
    });
    expect(vehicle.plate).toBe("2547 GH 01");
    expect(vehicle.plateCompact).toBe("2547GH01");
  });

  it("vehicle.create refuse une plaque déjà existante (US-M02-03)", async () => {
    await expect(
      caller.vehicle.create({
        customerId: customer.id,
        plate: "2547 gh 01",
        make: "Toyota",
        model: "Corolla",
      }),
    ).rejects.toThrow(/existe déjà/);
  });

  it("vehicle.recordMileage refuse un relevé inférieur sans correction (RG-M02-09)", async () => {
    const vehicle = await caller.vehicle.create({
      customerId: customer.id,
      plate: "1000 AA 01",
      make: "Hyundai",
      model: "Tucson",
    });
    await caller.vehicle.recordMileage({
      vehicleId: vehicle.id,
      mileage: 48200,
      readAt: new Date("2026-10-18"),
      source: "RECEPTION",
    });

    await expect(
      caller.vehicle.recordMileage({
        vehicleId: vehicle.id,
        mileage: 4820,
        readAt: new Date("2026-10-19"),
        source: "RECEPTION",
      }),
    ).rejects.toThrow(/Vérifiez la saisie/);

    const withReset = await caller.vehicle.recordMileage({
      vehicleId: vehicle.id,
      mileage: 100,
      readAt: new Date("2026-10-19"),
      source: "RECEPTION",
      odometerReset: true,
    });
    expect(withReset.vehicle.odometerOffset).toBe(48100);

    const event = await adminDb.vehicleEvent.findFirst({
      where: { vehicleId: vehicle.id, type: "odometer_replaced" },
    });
    expect(event).not.toBeNull();
  });

  it("vehicle.recordInspection calcule l'expiration et refuse une date antérieure", async () => {
    const vehicle = await caller.vehicle.create({
      customerId: customer.id,
      plate: "2000 BB 01",
      make: "Kia",
      model: "Picanto",
    });

    await expect(
      caller.vehicle.recordInspection({
        vehicleId: vehicle.id,
        date: new Date("2026-10-20"),
        expiryDate: new Date("2026-10-01"),
      }),
    ).rejects.toThrow(/après la date de la visite/);

    const updated = await caller.vehicle.recordInspection({
      vehicleId: vehicle.id,
      date: new Date("2026-10-20"),
      expiryDate: new Date("2027-10-20"),
      center: "SICTA Yopougon",
    });
    expect(updated.inspectionExpiryDate?.toISOString().slice(0, 10)).toBe("2027-10-20");
  });

  it("vehicle.transferOwner refuse un véhicule avec un OR ouvert, puis réussit (US-M02-11)", async () => {
    const otherCustomer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Nouveau Propriétaire", type: "INDIVIDUAL" },
    });
    const vehicle = await caller.vehicle.create({
      customerId: customer.id,
      plate: "3000 CC 01",
      make: "Peugeot",
      model: "301",
    });
    const site = await adminDb.site.create({
      data: {
        organizationId: org.id,
        name: "Site Transfert",
        code: `TR${randomBytes(2).toString("hex")}`,
      },
    });
    const repairOrder = await adminDb.repairOrder.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        number: `OR-TEST-${randomBytes(3).toString("hex")}`,
        customerId: customer.id,
        vehicleId: vehicle.id,
        status: "IN_PROGRESS",
      },
    });

    await expect(
      caller.vehicle.transferOwner({
        vehicleId: vehicle.id,
        toCustomerId: otherCustomer.id,
        effectiveDate: new Date(),
      }),
    ).rejects.toThrow(/OR est en cours/);

    await adminDb.repairOrder.update({
      where: { id: repairOrder.id },
      data: { status: "DELIVERED" },
    });

    const updated = await caller.vehicle.transferOwner({
      vehicleId: vehicle.id,
      toCustomerId: otherCustomer.id,
      effectiveDate: new Date(),
    });
    expect(updated.customerId).toBe(otherCustomer.id);

    await adminDb.repairOrder.delete({ where: { id: repairOrder.id } });
    await adminDb.site.delete({ where: { id: site.id } });
    // otherCustomer est nettoyé par afterAll (il possède désormais le véhicule transféré).
  });

  it("vehicle.setInsurance rattache une police, refuse la compagnie d'une autre organisation (M16)", async () => {
    const vehicle = await caller.vehicle.create({
      customerId: customer.id,
      plate: "8812 HK 01",
      make: "Hyundai",
      model: "Tucson",
    });
    const insurer = await adminDb.insuranceCompany.create({
      data: { organizationId: org.id, name: "Compagnie A Assurances" },
    });
    const otherOrg = await adminDb.organization.create({ data: { name: "Garage Autre" } });
    const foreign = await adminDb.insuranceCompany.create({
      data: { organizationId: otherOrg.id, name: "Compagnie étrangère" },
    });

    const linked = await caller.vehicle.setInsurance({
      vehicleId: vehicle.id,
      insuranceCompanyId: insurer.id,
      policyNumber: "POL-2026-778",
      expiryDate: "2026-12-31",
    });
    expect(linked.insuranceCompany?.name).toBe("Compagnie A Assurances");
    expect(linked.insurancePolicyNumber).toBe("POL-2026-778");
    expect(linked.insuranceExpiryDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: org.id, action: "vehicle.insurance_updated", entityId: vehicle.id },
    });
    expect(audit).not.toBeNull();

    await expect(
      caller.vehicle.setInsurance({
        vehicleId: vehicle.id,
        insuranceCompanyId: foreign.id,
        policyNumber: null,
        expiryDate: null,
      }),
    ).rejects.toThrow(/introuvable/);

    const cleared = await caller.vehicle.setInsurance({
      vehicleId: vehicle.id,
      insuranceCompanyId: null,
      policyNumber: null,
      expiryDate: null,
    });
    expect(cleared.insuranceCompanyId).toBeNull();
    expect(cleared.insurancePolicyNumber).toBeNull();

    await adminDb.insuranceCompany.deleteMany({ where: { id: { in: [insurer.id, foreign.id] } } });
    await adminDb.organization.delete({ where: { id: otherOrg.id } });
  });

  it("catalog.addLocalModel crée une marque/modèle local, visible ensuite par catalog.makes (RG-M02-20)", async () => {
    const localMakeName = `MarqueLocale-${randomBytes(3).toString("hex")}`;
    await caller.catalog.addLocalModel({ make: localMakeName, model: "ModèleX" });

    const makes = await caller.catalog.makes({ q: localMakeName });
    expect(makes.some((m) => m.name === localMakeName)).toBe(true);

    await adminDb.vehicleModel.deleteMany({ where: { make: { name: localMakeName } } });
    await adminDb.vehicleMake.deleteMany({ where: { name: localMakeName } });
  });
});
