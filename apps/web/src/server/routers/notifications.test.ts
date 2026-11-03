import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb, deleteTestOrganizations } from "@atelieros/db";
import { defaultPushOutbox } from "@atelieros/integrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function memberCaller(organizationId: string, role: "OWNER" | "ADVISOR", userIds: string[]) {
  const user = await adminDb.user.create({
    data: { name: `${role} notif`, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  userIds.push(user.id);
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
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return { caller: callerFactory(ctx), membershipId: membership.id };
}

describe("notifications router (cloche + push PWA)", () => {
  const userIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let ownerA: Awaited<ReturnType<typeof memberCaller>>;
  let advisorA: Awaited<ReturnType<typeof memberCaller>>;
  let ownerB: Awaited<ReturnType<typeof memberCaller>>;

  beforeAll(async () => {
    orgA = (await adminDb.organization.create({ data: { name: "Notif A" } })).id;
    orgB = (await adminDb.organization.create({ data: { name: "Notif B" } })).id;
    ownerA = await memberCaller(orgA, "OWNER", userIds);
    advisorA = await memberCaller(orgA, "ADVISOR", userIds);
    ownerB = await memberCaller(orgB, "OWNER", userIds);
    const base = new Date("2026-11-02T08:00:00Z").getTime();
    await adminDb.notification.createMany({
      data: [1, 2, 3].map((i) => ({
        organizationId: orgA,
        membershipId: ownerA.membershipId,
        type: "reminder.internal_alert",
        title: `Alerte ${i}`,
        link: "/creances",
        createdAt: new Date(base + i * 60_000),
      })),
    });
    await adminDb.notification.create({
      data: {
        organizationId: orgA,
        membershipId: advisorA.membershipId,
        type: "quote.expired",
        title: "Devis expiré",
      },
    });
  });

  afterAll(async () => {
    await deleteTestOrganizations([orgA, orgB], userIds);
  });

  it("chaque membre ne voit que ses notifications, les plus récentes d'abord, paginées", async () => {
    const page1 = await ownerA.caller.notifications.list({ limit: 2 });
    expect(page1.items.map((n) => n.title)).toEqual(["Alerte 3", "Alerte 2"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await ownerA.caller.notifications.list({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((n) => n.title)).toEqual(["Alerte 1"]);

    expect((await advisorA.caller.notifications.list({})).items.map((n) => n.title)).toEqual([
      "Devis expiré",
    ]);
    expect((await ownerB.caller.notifications.list({})).items).toHaveLength(0);
    expect((await ownerB.caller.notifications.unreadCount()).count).toBe(0);
  });

  it("marquer comme lu : une notification, puis toutes ; jamais celles d'un autre", async () => {
    expect((await ownerA.caller.notifications.unreadCount()).count).toBe(3);
    const [first] = (await ownerA.caller.notifications.list({ limit: 1 })).items;

    // Un autre membre ne peut pas marquer la notification comme lue.
    expect((await advisorA.caller.notifications.markRead({ ids: [first!.id] })).count).toBe(0);
    expect((await ownerB.caller.notifications.markRead({ ids: [first!.id] })).count).toBe(0);

    expect((await ownerA.caller.notifications.markRead({ ids: [first!.id] })).count).toBe(1);
    expect((await ownerA.caller.notifications.unreadCount()).count).toBe(2);
    expect((await ownerA.caller.notifications.list({ unreadOnly: true })).items).toHaveLength(2);

    expect((await ownerA.caller.notifications.markAllRead()).count).toBe(2);
    expect((await ownerA.caller.notifications.unreadCount()).count).toBe(0);
    expect((await advisorA.caller.notifications.unreadCount()).count).toBe(1);
  });

  it("abonnement push : rattaché au membre, test immédiat, désabonnement", async () => {
    const endpoint = `https://push.example.com/${randomBytes(6).toString("hex")}`;
    await ownerA.caller.notifications.push.subscribe({
      endpoint,
      keys: { p256dh: "p256", auth: "auth" },
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
    });
    // Re-souscription idempotente, puis changement de compte sur le même téléphone.
    await ownerA.caller.notifications.push.subscribe({
      endpoint,
      keys: { p256dh: "p256", auth: "auth" },
    });
    expect((await ownerA.caller.notifications.push.config()).devices).toBe(1);
    await advisorA.caller.notifications.push.subscribe({
      endpoint,
      keys: { p256dh: "p256", auth: "auth" },
    });
    expect((await ownerA.caller.notifications.push.config()).devices).toBe(0);
    expect((await advisorA.caller.notifications.push.config()).devices).toBe(1);

    // Le même téléphone peut aussi suivre un autre garage.
    await ownerB.caller.notifications.push.subscribe({
      endpoint,
      keys: { p256dh: "p256", auth: "auth" },
    });
    expect((await ownerB.caller.notifications.push.config()).devices).toBe(1);

    const before = defaultPushOutbox.entries.length;
    const result = await advisorA.caller.notifications.push.test();
    expect(result).toMatchObject({ sent: 1, provider: "console" });
    expect(defaultPushOutbox.entries.length).toBe(before + 1);
    expect(defaultPushOutbox.entries.at(-1)!.payload.title).toBe("Notifications activées");
    expect((await advisorA.caller.notifications.unreadCount()).count).toBe(2);

    // Désabonnement : seulement son propre appareil.
    expect((await ownerA.caller.notifications.push.unsubscribe({ endpoint })).removed).toBe(0);
    expect((await advisorA.caller.notifications.push.unsubscribe({ endpoint })).removed).toBe(1);
    expect((await ownerB.caller.notifications.push.config()).devices).toBe(1);
  });

  it("refuse un point de terminaison non HTTPS", async () => {
    await expect(
      ownerA.caller.notifications.push.subscribe({
        endpoint: "http://insecure.example.com/x",
        keys: { p256dh: "p", auth: "a" },
      }),
    ).rejects.toThrow();
  });
});
