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

describe("contact router (M02)", () => {
  let orgA: { id: string };
  let ownerA: { userId: string; membershipId: string; token: string };
  let customerA: { id: string };

  let orgB: { id: string };
  let ownerB: { userId: string; membershipId: string; token: string };
  let customerB: { id: string };

  const userIds: string[] = [];

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Contacts A", plan: "PRO" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Contacts A");
    userIds.push(ownerA.userId);
    customerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "COMPANY",
        companyName: "Flotte A",
        displayName: "Flotte A",
      },
    });

    orgB = await adminDb.organization.create({ data: { name: "Garage Contacts B", plan: "PRO" } });
    ownerB = await ownerContextFor(orgB.id, "Owner Contacts B");
    userIds.push(ownerB.userId);
    customerB = await adminDb.customer.create({
      data: {
        organizationId: orgB.id,
        type: "COMPANY",
        companyName: "Flotte B",
        displayName: "Flotte B",
      },
    });
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customerContact.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("contact.create crée un contact et journalise contact.created", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const contact = await caller.contact.create({
      customerId: customerA.id,
      name: "Koné Ibrahim",
      role: "Gestionnaire flotte",
      phone: "0708999999",
      isPrimary: true,
    });
    expect(contact.name).toBe("Koné Ibrahim");
    expect(contact.isPrimary).toBe(true);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "contact.created", entityId: contact.id },
    });
    expect(log).not.toBeNull();
  });

  it("contact.create refuse un client inexistant ou d'une autre organisation", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(
      callerA.contact.create({ customerId: customerB.id, name: "Intrus" }),
    ).rejects.toThrow();
  });

  it("contact.update modifie les champs et journalise contact.updated", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const contact = await caller.contact.create({ customerId: customerA.id, name: "Avant" });
    const updated = await caller.contact.update({
      id: contact.id,
      patch: { name: "Après", receivesInvoices: true },
    });
    expect(updated.name).toBe("Après");
    expect(updated.receivesInvoices).toBe(true);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "contact.updated", entityId: contact.id },
    });
    expect(log).not.toBeNull();
  });

  it("contact.update isole par organisation : un contact d'orgA est invisible pour orgB", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const callerB = callerFactory(await contextFor(ownerB.token));
    const contact = await callerA.contact.create({ customerId: customerA.id, name: "Isolé" });

    await expect(
      callerB.contact.update({ id: contact.id, patch: { name: "Volé" } }),
    ).rejects.toThrow();
  });

  it("contact.delete supprime logiquement le contact (deletedAt)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const contact = await caller.contact.create({ customerId: customerA.id, name: "À supprimer" });
    const result = await caller.contact.delete({ id: contact.id });
    expect(result.ok).toBe(true);

    const row = await adminDb.customerContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(row.deletedAt).not.toBeNull();

    await expect(caller.contact.delete({ id: contact.id })).rejects.toThrow();
  });
});
