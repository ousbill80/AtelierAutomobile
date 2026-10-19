import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function callerFor(
  organizationId: string,
  role: "OWNER" | "ADVISOR" | "MECHANIC",
  siteIds: string[] = [],
) {
  const user = await adminDb.user.create({
    data: { name: `Dash ${role}`, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds },
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
  return { caller: callerFactory(ctx), membership };
}

const DAY = 24 * 60 * 60 * 1000;

describe("dashboard / alerts routers (M12 partie 1)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let siteA1: { id: string };
  let siteA2: { id: string };
  let ownerA: Awaited<ReturnType<typeof callerFor>>;
  let ownerB: Awaited<ReturnType<typeof callerFor>>;

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Dashboard A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Dashboard B" } });
    siteA1 = await adminDb.site.create({
      data: {
        organizationId: orgA.id,
        name: "Yopougon",
        code: `Y${randomBytes(2).toString("hex")}`,
      },
    });
    siteA2 = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Cocody", code: `C${randomBytes(2).toString("hex")}` },
    });
    ownerA = await callerFor(orgA.id, "OWNER");
    ownerB = await callerFor(orgB.id, "OWNER");

    const customer = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "SOTRA Logistique",
        type: "COMPANY",
        phone: "+2250747210099",
      },
    });
    const now = Date.now();
    await adminDb.invoice.createMany({
      data: [
        {
          organizationId: orgA.id,
          siteId: siteA1.id,
          customerId: customer.id,
          number: `FAC-T-${randomBytes(3).toString("hex")}`,
          status: "OVERDUE",
          issuedAt: new Date(now - 60 * DAY),
          dueDate: new Date(now - 50 * DAY),
          total: 1_240_000,
          balance: 1_240_000,
        },
        {
          organizationId: orgA.id,
          siteId: siteA2.id,
          customerId: customer.id,
          number: `FAC-T-${randomBytes(3).toString("hex")}`,
          status: "ISSUED",
          issuedAt: new Date(now - 5 * DAY),
          dueDate: new Date(now + 10 * DAY),
          total: 185_000,
          balance: 185_000,
        },
      ],
    });
    await adminDb.notification.createMany({
      data: [
        {
          organizationId: orgA.id,
          membershipId: ownerA.membership.id,
          type: "alert.channel_error",
          title: "Canal WhatsApp en erreur",
          severity: "critical",
          dedupeKey: "alert.channel_error:cc:2026-10-19",
        },
        {
          organizationId: orgA.id,
          membershipId: ownerA.membership.id,
          type: "alert.sms_balance_low",
          title: "Crédit SMS bas",
          severity: "warning",
          dedupeKey: "alert.sms_balance_low:cc:2026-10-19",
        },
      ],
    });
  });

  it("finances : créances calculées depuis les soldes de facture", async () => {
    const result = await ownerA.caller.dashboard.finances({ period: "month" });
    expect(result.hasInvoices).toBe(true);
    expect(result.receivables).toMatchObject({
      total: 1_425_000,
      overdue: 1_240_000,
      over30: 1_240_000,
    });
    expect(result.receivables.buckets.d31_60).toBe(1_240_000);
    expect(result.topUnpaid[0]).toMatchObject({
      customerName: "SOTRA Logistique",
      balance: 1_425_000,
    });
  });

  it("isolation multi-locataire : l'organisation B ne voit rien de A", async () => {
    const finances = await ownerB.caller.dashboard.finances({ period: "month" });
    expect(finances.hasInvoices).toBe(false);
    expect(finances.receivables.total).toBe(0);
    const overview = await ownerB.caller.dashboard.overview({ period: "month" });
    expect(overview.topUnpaid).toEqual([]);
    expect(await ownerB.caller.alerts.list({})).toEqual([]);
    const marked = await ownerB.caller.alerts.markRead({
      ids: (await ownerA.caller.alerts.list({})).map((n) => n.id),
    });
    expect(marked.count).toBe(0);
  });

  it("restriction de site : filtre intersecté avec Membership.siteIds", async () => {
    const restricted = await callerFor(orgA.id, "OWNER", [siteA2.id]);
    const finances = await restricted.caller.dashboard.finances({ period: "month" });
    expect(finances.receivables.total).toBe(185_000);
    await expect(
      restricted.caller.dashboard.finances({ period: "month", siteId: siteA1.id }),
    ).rejects.toThrow("Vous n'avez pas accès à ce site.");
    const overview = await restricted.caller.dashboard.overview({ period: "month" });
    expect(overview.inspectionsDue30).toBeNull();
  });

  it("permissions : MECHANIC refusé ; ADVISOR voit Relances mais pas Finances", async () => {
    const mechanic = await callerFor(orgA.id, "MECHANIC");
    await expect(mechanic.caller.dashboard.reminders({ period: "month" })).rejects.toThrow(
      /Permission manquante/,
    );
    const advisor = await callerFor(orgA.id, "ADVISOR");
    await expect(advisor.caller.dashboard.reminders({ period: "30d" })).resolves.toMatchObject({
      sent: 0,
    });
    await expect(advisor.caller.dashboard.finances({ period: "month" })).rejects.toThrow(
      /report:financial/,
    );
  });

  it("alertes : tri par sévérité puis marquer comme lu", async () => {
    const list = await ownerA.caller.alerts.list({});
    expect(list.map((n) => n.severity)).toEqual(["critical", "warning"]);
    await ownerA.caller.alerts.markRead({ ids: [list[0]!.id] });
    expect((await ownerA.caller.alerts.list({})).map((n) => n.severity)).toEqual(["warning"]);
  });
  it("digest : aperçu RG-M12-30 et réglages (destinataire d'une autre organisation refusé)", async () => {
    const { text } = await ownerA.caller.digest.preview();
    expect(text).toContain("☀️ Garage Dashboard A — ");
    expect(text).toContain("ARGENT DEHORS : 1 425 000 FCFA dont 1 240 000 à +30 j");
    expect(text).toContain("⚠️ Crédit SMS bas");

    await expect(
      ownerA.caller.digest.updateSettings({
        enabled: true,
        time: "08:00",
        channel: "WHATSAPP",
        recipients: [ownerB.membership.id],
      }),
    ).rejects.toThrow("Un destinataire du résumé n'est pas un membre actif de ce garage.");
    await ownerA.caller.digest.updateSettings({
      enabled: true,
      time: "08:00",
      channel: "EMAIL",
      recipients: [ownerA.membership.id],
    });
    expect(await ownerA.caller.digest.getSettings()).toMatchObject({
      time: "08:00",
      channel: "EMAIL",
    });
    expect(await ownerB.caller.digest.getSettings()).toMatchObject({ time: "07:30" });
  });
});
