// Messages (M11) : liste des conversations paginée, fil avec les envois automatiques vers la
// même adresse, journal des envois filtré par état, isolation multi-locataire.
import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function callerFor(
  organizationId: string,
  name: string,
  role: "OWNER" | "ADVISOR" | "CASHIER" | "MECHANIC" = "OWNER",
) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
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
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return { userId: user.id, membershipId: ctx.membership!.id, caller: callerFactory(ctx) };
}

describe("messaging (Messages : conversations et envois)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  const users: string[] = [];
  let callerA: ReturnType<typeof callerFactory>;
  let callerB: ReturnType<typeof callerFactory>;
  let conversationId: string;
  const phone = "+2250700000777";

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Messages A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Messages B" } });
    const a = await callerFor(orgA.id, "Owner Messages A");
    const b = await callerFor(orgB.id, "Owner Messages B");
    users.push(a.userId, b.userId);
    callerA = a.caller;
    callerB = b.caller;

    const customer = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Awa Traoré", phone },
    });
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    // Relance automatique (sans conversation) puis réponse du client (conversation).
    await adminDb.message.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        direction: "OUTBOUND",
        channel: "SMS",
        to: phone,
        body: "Votre visite technique expire bientôt.",
        status: "DELIVERED",
        provider: "orange_sms",
        kind: "REMINDER",
        createdAt: minutesAgo(60),
        sentAt: minutesAgo(60),
        deliveredAt: minutesAgo(59),
      },
    });
    const conversation = await adminDb.conversation.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        channel: "SMS",
        externalAddress: phone,
        lastMessageAt: minutesAgo(30),
        unreadCount: 1,
      },
    });
    conversationId = conversation.id;
    await adminDb.message.create({
      data: {
        organizationId: orgA.id,
        conversationId,
        customerId: customer.id,
        direction: "INBOUND",
        channel: "SMS",
        to: "",
        from: phone,
        body: "Je passe lundi.",
        status: "DELIVERED",
        provider: "orange_sms",
        kind: "CONVERSATION",
        createdAt: minutesAgo(30),
      },
    });
    await adminDb.message.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        direction: "OUTBOUND",
        channel: "SMS",
        to: "+2250100000000",
        body: "Reçu de paiement",
        status: "FAILED",
        provider: "orange_sms",
        kind: "TRANSACTIONAL",
        errorMessage: "Numéro invalide",
        createdAt: minutesAgo(10),
      },
    });
    // Deux autres conversations pour la pagination.
    for (const n of [1, 2]) {
      await adminDb.conversation.create({
        data: {
          organizationId: orgA.id,
          channel: "SMS",
          externalAddress: `+22507000008${n}0`,
          lastMessageAt: minutesAgo(100 + n),
        },
      });
    }
  });

  afterAll(async () => {
    const orgs = { organizationId: { in: [orgA.id, orgB.id] } };
    await adminDb.message.deleteMany({ where: orgs });
    await adminDb.conversation.deleteMany({ where: orgs });
    await adminDb.customer.deleteMany({ where: orgs });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where: orgs });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("liste paginée avec dernier message, compteurs et recherche", async () => {
    const first = await callerA.messaging.conversations.list({ filter: "ALL", limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.items[0]!.id).toBe(conversationId);
    expect(first.items[0]!.lastMessage).toMatchObject({
      direction: "INBOUND",
      preview: "Je passe lundi.",
    });
    expect(first.counts).toMatchObject({ ALL: 3, UNREAD: 1 });
    expect(first.nextCursor).not.toBeNull();
    const second = await callerA.messaging.conversations.list({
      filter: "ALL",
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const found = await callerA.messaging.conversations.list({ filter: "ALL", search: "awa" });
    expect(found.items.map((c) => c.id)).toEqual([conversationId]);
  });

  it("le fil contient la relance envoyée au même numéro avant la réponse du client", async () => {
    const thread = await callerA.messaging.conversations.get({ id: conversationId });
    expect(thread.messages.map((m) => m.body)).toEqual([
      "Votre visite technique expire bientôt.",
      "Je passe lundi.",
    ]);
    expect(thread.messages[0]!.delivery).toBe("delivered");
    expect(thread.messages[1]!.delivery).toBeNull();
  });

  it("journal des envois : sortants seulement, filtre « Échecs » avec le motif", async () => {
    const all = await callerA.messaging.log({});
    expect(all.items).toHaveLength(2);
    expect(all.summary).toMatchObject({ FAILED: 1, DELIVERED: 1 });
    const failed = await callerA.messaging.log({ state: "FAILED" });
    expect(failed.items).toHaveLength(1);
    expect(failed.items[0]).toMatchObject({ errorMessage: "Numéro invalide", delivery: "failed" });
    const reminders = await callerA.messaging.log({ kind: "REMINDER", q: "visite" });
    expect(reminders.items).toHaveLength(1);
  });

  it("assignation : prendre en charge, confier à un collègue, filtres et refus", async () => {
    const advisor = await callerFor(orgA.id, "Conseiller A", "ADVISOR");
    const cashier = await callerFor(orgA.id, "Caissière A", "CASHIER");
    const mechanic = await callerFor(orgA.id, "Mécanicien A", "MECHANIC");
    const ownerB = (await callerB.me.get()).membership!.id;
    users.push(advisor.userId, cashier.userId, mechanic.userId);

    // Le mécanicien n'a pas accès aux messages : on ne peut pas lui confier une conversation.
    const assignees = await callerA.messaging.conversations.assignees();
    const names = assignees.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["Owner Messages A", "Conseiller A"]));
    expect(names).toContain("Caissière A");
    expect(names).not.toContain("Mécanicien A");
    expect(assignees.filter((m) => m.isMe).map((m) => m.name)).toEqual(["Owner Messages A"]);

    // Le conseiller prend la conversation en charge.
    const taken = await advisor.caller.messaging.conversations.assign({
      conversationId,
      assignedToId: advisor.membershipId,
    });
    expect(taken.assignee).toMatchObject({ name: "Conseiller A", isMe: true });
    const mine = await advisor.caller.messaging.conversations.list({ filter: "ASSIGNED_TO_ME" });
    expect(mine.items.map((c) => c.id)).toEqual([conversationId]);
    expect(mine.counts).toMatchObject({ ASSIGNED_TO_ME: 1, UNASSIGNED: 2 });
    const seenByOwner = await callerA.messaging.conversations.get({ id: conversationId });
    expect(seenByOwner.conversation.assignee).toMatchObject({ name: "Conseiller A", isMe: false });

    // Refus : membre d'un autre garage, membre sans accès aux messages, rôle sans message:assign.
    await expect(
      callerA.messaging.conversations.assign({ conversationId, assignedToId: ownerB }),
    ).rejects.toThrow(/ne peut pas recevoir/);
    await expect(
      callerA.messaging.conversations.assign({
        conversationId,
        assignedToId: mechanic.membershipId,
      }),
    ).rejects.toThrow(/ne peut pas recevoir/);
    await expect(
      cashier.caller.messaging.conversations.assign({ conversationId, assignedToId: null }),
    ).rejects.toThrow();

    // Libérer : la conversation repart dans « Sans responsable ».
    await callerA.messaging.conversations.assign({ conversationId, assignedToId: null });
    const free = await callerA.messaging.conversations.list({ filter: "UNASSIGNED" });
    expect(free.items.map((c) => c.id)).toContain(conversationId);
  });

  it("isolation : un autre garage ne voit ni les conversations ni les envois", async () => {
    const list = await callerB.messaging.conversations.list({ filter: "ALL" });
    expect(list.items).toEqual([]);
    const log = await callerB.messaging.log({});
    expect(log.items).toEqual([]);
    await expect(callerB.messaging.conversations.get({ id: conversationId })).rejects.toThrow();
    await expect(
      callerB.messaging.conversations.assign({ conversationId, assignedToId: null }),
    ).rejects.toThrow();
    const assigneesB = await callerB.messaging.conversations.assignees();
    expect(assigneesB.map((m) => m.name)).toEqual(["Owner Messages B"]);
  });
});
