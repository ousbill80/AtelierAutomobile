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

const VT_STEPS = [
  {
    key: "J-30",
    label: "1er rappel",
    offsetDays: -30,
    templateKey: "vt_j30",
    autoSend: true,
    channels: ["WHATSAPP"],
  },
  {
    key: "J0",
    label: "Échéance",
    offsetDays: 0,
    templateKey: "vt_j0",
    autoSend: true,
    channels: ["WHATSAPP"],
  },
];
const SEND_WINDOW = {
  days: [1, 2, 3, 4, 5, 6],
  from: "08:00",
  to: "19:00",
  preferredTime: "09:00",
};

describe("reminders.history — page Résultats des relances (M10)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };
  let callerA: ReturnType<typeof callerFactory>;
  let callerB: ReturnType<typeof callerFactory>;
  let ids: Record<string, string> = {};

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Résultats A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Résultats B" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Résultats A");
    ownerB = await ownerContextFor(orgB.id, "Owner Résultats B");
    callerA = callerFactory(await contextFor(ownerA.token));
    callerB = callerFactory(await contextFor(ownerB.token));

    const customer = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Client Résultats", type: "INDIVIDUAL" },
    });
    const rule = await adminDb.reminderRule.create({
      data: {
        organizationId: orgA.id,
        type: "INSPECTION",
        name: "Visite technique",
        isActive: true,
        steps: VT_STEPS,
        sendWindow: SEND_WINDOW,
        conditions: {},
        stopOn: [],
      },
    });
    const make = async (
      name: string,
      data: {
        status: "SENT" | "FAILED" | "CANCELLED" | "SKIPPED" | "PLANNED";
        type?: "INSPECTION" | "SERVICE";
        sentAt?: Date;
        updatedAt?: Date;
        outcome?: "APPOINTMENT_BOOKED" | "NO_RESPONSE";
        skippedReason?: string;
      },
    ) => {
      const reminder = await adminDb.reminder.create({
        data: {
          organizationId: orgA.id,
          ruleId: rule.id,
          type: data.type ?? "INSPECTION",
          stepKey: "J-30",
          customerId: customer.id,
          dueDate: now,
          scheduledFor: now,
          status: data.status,
          channel: "WHATSAPP",
          sentAt: data.sentAt ?? null,
          outcome: data.outcome ?? null,
          outcomeAt: data.outcome ? now : null,
          skippedReason: data.skippedReason ?? null,
          dedupeKey: `history:${name}:${randomBytes(4).toString("hex")}`,
          sequenceKey: `history:${name}`,
        },
      });
      if (data.updatedAt) {
        await adminDb.$executeRaw`UPDATE "Reminder" SET "updatedAt" = ${data.updatedAt} WHERE id = ${reminder.id}`;
      }
      ids[name] = reminder.id;
    };
    ids = {};
    await make("sentBooked", { status: "SENT", sentAt: daysAgo(2), outcome: "APPOINTMENT_BOOKED" });
    await make("sentService", { status: "SENT", type: "SERVICE", sentAt: daysAgo(3) });
    await make("failed", { status: "FAILED", updatedAt: daysAgo(1) });
    await make("skipped", { status: "SKIPPED", skippedReason: "Client désinscrit" });
    await make("cancelled", { status: "CANCELLED" });
    await make("planned", { status: "PLANNED" });
    await make("oldSent", { status: "SENT", sentAt: daysAgo(90), updatedAt: daysAgo(1) });
  });

  afterAll(async () => {
    for (const org of [orgA, orgB]) {
      await adminDb.reminder.deleteMany({ where: { organizationId: org.id } });
      await adminDb.reminderRule.deleteMany({ where: { organizationId: org.id } });
      await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
      await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    }
    await adminDb.session.deleteMany({ where: { userId: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  const range = () => ({ from: daysAgo(30), to: new Date(Date.now() + 60_000) });

  it("liste les relances terminées de la période, sans les planifiées ni celles envoyées avant", async () => {
    const result = await callerA.reminders.history(range());
    const listed = new Set(result.items.map((r) => r.id));
    for (const name of ["sentBooked", "sentService", "failed", "skipped", "cancelled"]) {
      expect(listed.has(ids[name]!)).toBe(true);
    }
    expect(listed.has(ids.planned!)).toBe(false);
    // Envoyée il y a 90 jours : sa date d'activité est sentAt, même si updatedAt est récent.
    expect(listed.has(ids.oldSent!)).toBe(false);
  });

  it("synthèse par statut et par issue sur la période", async () => {
    const result = await callerA.reminders.history(range());
    expect(result.summary?.byStatus).toEqual({ SENT: 2, FAILED: 1, CANCELLED: 1, SKIPPED: 1 });
    expect(result.summary?.byOutcome).toEqual([{ outcome: "APPOINTMENT_BOOKED", count: 1 }]);
  });

  it("filtre par statut (liste seulement) et par type (liste et synthèse)", async () => {
    const failed = await callerA.reminders.history({ ...range(), status: "FAILED" });
    expect(failed.items.map((r) => r.id)).toEqual([ids.failed]);
    expect(failed.summary?.byStatus.SENT).toBe(2);

    const service = await callerA.reminders.history({ ...range(), type: "SERVICE" });
    expect(service.items.map((r) => r.id)).toEqual([ids.sentService]);
    expect(service.summary?.byStatus).toEqual({ SENT: 1, FAILED: 0, CANCELLED: 0, SKIPPED: 0 });
  });

  it("pagine par curseur sans répéter de relance", async () => {
    const first = await callerA.reminders.history({ ...range(), limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await callerA.reminders.history({
      ...range(),
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.summary).toBeNull();
    const firstIds = first.items.map((r) => r.id);
    for (const item of second.items) expect(firstIds).not.toContain(item.id);
  });

  it("isolation multi-locataire : l'organisation B ne voit rien de A", async () => {
    const result = await callerB.reminders.history(range());
    expect(result.items).toEqual([]);
    expect(result.summary?.byStatus).toEqual({ SENT: 0, FAILED: 0, CANCELLED: 0, SKIPPED: 0 });
  });

  it("refuse une période inversée", async () => {
    await expect(callerA.reminders.history({ from: new Date(), to: daysAgo(1) })).rejects.toThrow();
  });
});
