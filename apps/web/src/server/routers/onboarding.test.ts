import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { defaultOutbox } from "@atelieros/integrations";
import { reminderRuleUpsertInputSchema } from "@atelieros/validators";
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

async function createUserSession() {
  const user = await adminDb.user.create({
    data: { name: "Nouvel utilisateur", email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      isPinSession: false,
    },
  });
  return { userId: user.id, token };
}

describe("onboarding router (M01, RG-M01-16/17)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.invitation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.bay.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.channelConfig.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.laborOperation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.inspectionTemplate.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.messageTemplate.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.reminderRule.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("onboarding.get renvoie l'étape 2 pour un utilisateur sans organisation", async () => {
    const { userId, token } = await createUserSession();
    userIds.push(userId);
    const caller = callerFactory(await contextFor(token));
    const state = await caller.onboarding.get();
    expect(state.step).toBe(2);
    expect(state.skipped).toEqual([]);
  });

  it("saveStep étape 3 (atelier) refuse avant la création du garage", async () => {
    const { userId, token } = await createUserSession();
    userIds.push(userId);
    const caller = callerFactory(await contextFor(token));
    await expect(
      caller.onboarding.saveStep({
        step: 3,
        data: { name: "Site principal", code: "ABJ" },
      }),
    ).rejects.toThrow("Créez d'abord votre garage");
  });

  describe("parcours complet", () => {
    let userId: string;
    let token: string;
    let orgId: string;

    beforeAll(async () => {
      const session = await createUserSession();
      userId = session.userId;
      token = session.token;
      userIds.push(userId);
    });

    it("étape 2 (garage) crée l'organisation, la Membership OWNER et les semences par défaut", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({
        step: 2,
        data: { name: "Garage Excellence Auto", commune: "Yopougon" },
      });
      expect(result).toEqual({ nextStep: 3 });

      const user = await adminDb.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.lastActiveOrganizationId).toBeTruthy();
      orgId = user.lastActiveOrganizationId!;
      orgIds.push(orgId);

      const org = await adminDb.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.name).toBe("Garage Excellence Auto");
      expect(org.city).toBe("Yopougon");

      const membership = await adminDb.membership.findFirstOrThrow({
        where: { organizationId: orgId, userId },
      });
      expect(membership.role).toBe("OWNER");

      // RG-M10-02 / Annexe A : 9 règles (dont 2 inactives) et 97 modèles par (clé, canal).
      expect(await adminDb.reminderRule.count({ where: { organizationId: orgId } })).toBe(9);
      expect(
        await adminDb.reminderRule.count({ where: { organizationId: orgId, isActive: false } }),
      ).toBe(2);
      expect(await adminDb.messageTemplate.count({ where: { organizationId: orgId } })).toBe(97);
      // Les règles installées restent éditables : elles passent le schéma de reminderRules.upsert.
      const rules = await adminDb.reminderRule.findMany({ where: { organizationId: orgId } });
      for (const rule of rules) {
        const parsed = reminderRuleUpsertInputSchema.safeParse({
          type: rule.type,
          name: rule.name,
          isActive: rule.isActive,
          steps: rule.steps,
          sendWindow: rule.sendWindow,
          conditions: rule.conditions,
          stopOn: rule.stopOn,
        });
        expect(parsed.success, `${rule.name} : ${parsed.error?.message}`).toBe(true);
      }
      expect(await adminDb.inspectionTemplate.count({ where: { organizationId: orgId } })).toBe(1);
      expect(await adminDb.laborOperation.count({ where: { organizationId: orgId } })).toBe(26);
      expect(await adminDb.channelConfig.count({ where: { organizationId: orgId } })).toBe(2);

      const auditLog = await adminDb.auditLog.findFirstOrThrow({
        where: { organizationId: orgId, action: "organization.created" },
      });
      expect(auditLog.membershipId).toBe(membership.id);
    });

    it("étape 3 (atelier) crée le site et ses ponts, active le site en session", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({
        step: 3,
        data: {
          name: "Site principal",
          code: "YOP",
          bays: [{ name: "Pont 1", type: "LIFT" }],
        },
      });
      expect(result.nextStep).toBe(4);

      const site = await adminDb.site.findFirstOrThrow({
        where: { organizationId: orgId, code: "YOP" },
        include: { bays: true },
      });
      expect(site.bays).toHaveLength(1);

      const session = await adminDb.session.findFirstOrThrow({ where: { userId } });
      expect(session.activeSiteId).toBe(site.id);

      const auditLog = await adminDb.auditLog.findFirstOrThrow({
        where: { organizationId: orgId, action: "site.created" },
      });
      expect(auditLog.entityId).toBe(site.id);
    });

    it("étape 4 (mode) met à jour l'operatingMode et journalise le changement", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({
        step: 4,
        data: { operatingMode: "REMINDERS_ONLY" },
      });
      expect(result).toEqual({ nextStep: 5 });

      const org = await adminDb.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.operatingMode).toBe("REMINDERS_ONLY");

      const auditLog = await adminDb.auditLog.findFirstOrThrow({
        where: { organizationId: orgId, action: "org.updated" },
      });
      expect(auditLog.after).toMatchObject({ operatingMode: "REMINDERS_ONLY" });
    });

    it("étape 5 (équipe) omise marque l'étape comme passée sans effet de bord", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({ step: 5 });
      expect(result).toEqual({ nextStep: 6, invitationIds: [] });

      const org = await adminDb.organization.findUniqueOrThrow({ where: { id: orgId } });
      const onboarding = (org.settings as { onboarding: { skipped: number[] } }).onboarding;
      expect(onboarding.skipped).toContain(5);
    });

    it("étape 5 (équipe) avec invitations crée les Invitation et envoie un message", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({
        step: 5,
        data: {
          invitations: [
            {
              name: "Koné Ibrahim",
              phone: "+2250700000099",
              role: "MECHANIC",
              channel: "WHATSAPP",
            },
          ],
        },
      });
      if (!("invitationIds" in result)) throw new Error("invitationIds manquant");
      expect(result.invitationIds).toHaveLength(1);

      const invitation = await adminDb.invitation.findUniqueOrThrow({
        where: { id: result.invitationIds[0] },
      });
      expect(invitation.role).toBe("MECHANIC");
      expect(invitation.status).toBe("PENDING");

      const sent = defaultOutbox.lastFor("+2250700000099");
      expect(sent?.body).toContain("Garage Excellence Auto");

      const auditLog = await adminDb.auditLog.findFirstOrThrow({
        where: { organizationId: orgId, action: "member.invited" },
      });
      expect(auditLog.entityId).toBe(invitation.id);
    });

    it("étape 6 (canaux) omise marque l'étape comme passée", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({ step: 6 });
      expect(result).toEqual({ nextStep: 7, testSent: false });
    });

    it("étape 6 (canaux) active SMS/email et envoie un message de test", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({
        step: 6,
        data: {
          whatsappProvider: "wa_link",
          smsEnabled: true,
          emailEnabled: true,
          sendTestTo: "+2250700000098",
        },
      });
      if (!("testSent" in result)) throw new Error("testSent manquant");
      expect(result.testSent).toBe(true);

      const sms = await adminDb.channelConfig.findFirstOrThrow({
        where: { organizationId: orgId, channel: "SMS" },
      });
      expect(sms.isActive).toBe(true);
      const email = await adminDb.channelConfig.findFirstOrThrow({
        where: { organizationId: orgId, channel: "EMAIL" },
      });
      expect(email.isActive).toBe(true);

      expect(defaultOutbox.lastFor("+2250700000098")).toBeDefined();
    });

    it("étape 7 (données) avec choice=demo charge les clients/véhicules de démonstration", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({
        step: 7,
        data: { choice: "demo" },
      });
      if (!("counts" in result)) throw new Error("counts manquant");
      expect(result.counts).toEqual({ customers: 3, vehicles: 3 });

      expect(
        await adminDb.customer.count({ where: { organizationId: orgId, source: "demo" } }),
      ).toBe(3);
    });

    it("étape 8 (terminé) renseigne onboardingCompletedAt", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.saveStep({ step: 8 });
      expect(result).toEqual({ nextStep: 8 });

      const org = await adminDb.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.onboardingCompletedAt).not.toBeNull();
    });

    it("onboarding.get reflète la progression courante", async () => {
      const caller = callerFactory(await contextFor(token));
      const state = await caller.onboarding.get();
      expect(state.step).toBe(8);
      expect(state.data.onboardingCompletedAt).not.toBeNull();
    });

    it("purgeDemoData supprime les clients et véhicules marqués demo", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.purgeDemoData();
      expect(result.counts).toEqual({ customers: 3, vehicles: 3 });

      expect(
        await adminDb.customer.count({ where: { organizationId: orgId, source: "demo" } }),
      ).toBe(0);
    });

    it("loadDemoData peut être rappelée indépendamment de l'étape 7", async () => {
      const caller = callerFactory(await contextFor(token));
      const result = await caller.onboarding.loadDemoData();
      expect(result.counts).toEqual({ customers: 3, vehicles: 3 });
    });
  });

  it("étape 3 en mode REMINDERS_ONLY ne crée aucun pont par défaut", async () => {
    const { userId, token } = await createUserSession();
    userIds.push(userId);
    const caller = callerFactory(await contextFor(token));

    const garage = await caller.onboarding.saveStep({
      step: 2,
      data: { name: "Garage Mode Relances" },
    });
    expect(garage.nextStep).toBe(3);
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: userId } });
    const orgId = user.lastActiveOrganizationId!;
    orgIds.push(orgId);

    await adminDb.organization.update({
      where: { id: orgId },
      data: { operatingMode: "REMINDERS_ONLY" },
    });

    const callerAfterModeChange = callerFactory(await contextFor(token));
    const workshop = await callerAfterModeChange.onboarding.saveStep({
      step: 3,
      data: { name: "Site unique", code: "RMD" },
    });
    expect(workshop.nextStep).toBe(4);

    const site = await adminDb.site.findFirstOrThrow({
      where: { organizationId: orgId, code: "RMD" },
      include: { bays: true },
    });
    expect(site.bays).toHaveLength(0);
  });
});
