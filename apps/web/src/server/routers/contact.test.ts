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

async function ownerContextFor(
  organizationId: string,
  name: string,
  role: "OWNER" | "MECHANIC" = "OWNER",
) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds: [] },
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
  let mechanicA: { userId: string; membershipId: string; token: string };
  let customerA: { id: string };
  let deletedCustomerA: { id: string };

  let orgB: { id: string };
  let ownerB: { userId: string; membershipId: string; token: string };
  let customerB: { id: string };

  const userIds: string[] = [];

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Contacts A", plan: "PRO" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Contacts A");
    mechanicA = await ownerContextFor(orgA.id, "Mécanicien Contacts A", "MECHANIC");
    userIds.push(ownerA.userId, mechanicA.userId);
    customerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "COMPANY",
        companyName: "SOTRA Logistique SARL",
        displayName: "SOTRA Logistique SARL",
      },
    });
    deletedCustomerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "COMPANY",
        displayName: "Ancienne flotte",
        deletedAt: new Date(),
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

  it("contact.create crée un contact, normalise les téléphones en E.164 et journalise", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const contact = await caller.contact.create({
      customerId: customerA.id,
      name: "M. Diabaté",
      role: "Responsable flotte",
      phone: "07 08 99 99 99",
      receivesReminders: true,
    });
    expect(contact.name).toBe("M. Diabaté");
    expect(contact.phone).toBe("+2250708999999");
    expect(contact.receivesReminders).toBe(true);
    expect(contact.receivesInvoices).toBe(false);
    expect(contact.isPrimary).toBe(false);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "contact.created", entityId: contact.id },
    });
    expect(log).not.toBeNull();
  });

  it("contact.create refuse un numéro invalide avec un message lisible", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await expect(
      caller.contact.create({ customerId: customerA.id, name: "Numéro faux", phone: "12" }),
    ).rejects.toThrow();
  });

  it("contact.create refuse un client d'une autre organisation ou supprimé", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(
      callerA.contact.create({ customerId: customerB.id, name: "Intrus" }),
    ).rejects.toThrow("Client introuvable.");
    await expect(
      callerA.contact.create({ customerId: deletedCustomerA.id, name: "Fantôme" }),
    ).rejects.toThrow("Client introuvable.");
  });

  it("contact.create exige customer:update (un mécanicien est refusé)", async () => {
    const caller = callerFactory(await contextFor(mechanicA.token));
    await expect(
      caller.contact.create({ customerId: customerA.id, name: "Interdit" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un seul contact principal par client", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const first = await caller.contact.create({
      customerId: customerA.id,
      name: "Mme N'Guessan",
      role: "Comptabilité",
      receivesInvoices: true,
      isPrimary: true,
    });
    const second = await caller.contact.create({
      customerId: customerA.id,
      name: "M. Koné",
      role: "Dirigeant",
      isPrimary: true,
    });
    const reloadedFirst = await adminDb.customerContact.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(reloadedFirst.isPrimary).toBe(false);

    await caller.contact.update({ id: first.id, patch: { isPrimary: true } });
    const reloadedSecond = await adminDb.customerContact.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(reloadedSecond.isPrimary).toBe(false);

    const list = await caller.contact.list({ customerId: customerA.id });
    expect(list[0]?.id).toBe(first.id);
    expect(list.filter((c) => c.isPrimary)).toHaveLength(1);
  });

  it("contact.update modifie, efface un champ avec null et journalise contact.updated", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const contact = await caller.contact.create({
      customerId: customerA.id,
      name: "Avant",
      role: "Atelier",
      phone2: "0102030405",
    });
    const updated = await caller.contact.update({
      id: contact.id,
      patch: { name: "Après", role: null, phone: "0505050505", receivesInvoices: true },
    });
    expect(updated.name).toBe("Après");
    expect(updated.role).toBeNull();
    expect(updated.phone).toBe("+2250505050505");
    expect(updated.phone2).toBe("+2250102030405");
    expect(updated.receivesInvoices).toBe(true);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "contact.updated", entityId: contact.id },
    });
    expect(log).not.toBeNull();
  });

  it("isolation : un contact d'orgA est invisible et non modifiable pour orgB", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const callerB = callerFactory(await contextFor(ownerB.token));
    const contact = await callerA.contact.create({ customerId: customerA.id, name: "Isolé" });

    await expect(
      callerB.contact.update({ id: contact.id, patch: { name: "Volé" } }),
    ).rejects.toThrow("Contact introuvable.");
    await expect(callerB.contact.delete({ id: contact.id })).rejects.toThrow(
      "Contact introuvable.",
    );
    expect(await callerB.contact.list({ customerId: customerA.id })).toEqual([]);

    const row = await adminDb.customerContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(row.name).toBe("Isolé");
    expect(row.deletedAt).toBeNull();
  });

  it("contact.delete supprime logiquement, retire le contact de la liste et de la fiche", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const contact = await caller.contact.create({
      customerId: customerA.id,
      name: "À supprimer",
      isPrimary: true,
    });
    const result = await caller.contact.delete({ id: contact.id });
    expect(result.ok).toBe(true);

    const row = await adminDb.customerContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isPrimary).toBe(false);

    const list = await caller.contact.list({ customerId: customerA.id });
    expect(list.map((c) => c.id)).not.toContain(contact.id);
    const customer = await caller.customer.get({ id: customerA.id });
    expect(customer.contacts.map((c) => c.id)).not.toContain(contact.id);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "contact.deleted", entityId: contact.id },
    });
    expect(log).not.toBeNull();

    await expect(caller.contact.delete({ id: contact.id })).rejects.toThrow("Contact introuvable.");
  });
});
