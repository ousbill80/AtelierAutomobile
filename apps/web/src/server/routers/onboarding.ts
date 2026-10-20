import { TRPCError } from "@trpc/server";
import {
  defaultChannelConfigs,
  defaultInspectionTemplate,
  extraInspectionTemplates,
  defaultLaborOperations,
  defaultMessageTemplates,
  defaultReminderRules,
  defaultSiteBays,
  defaultSiteOpeningHours,
  normalizePlate,
  organizationSlug,
} from "@atelieros/core";
import { adminDb, db, type Prisma } from "@atelieros/db";
import { createConsoleMessagingProvider, type MessageChannel } from "@atelieros/integrations";
import { saveOnboardingStepInputSchema, type SaveOnboardingStepInput } from "@atelieros/validators";
import { authedProcedure, router } from "../trpc";
import type { Ctx, CtxSession, CtxUser } from "../context";
import { writeAuditLog } from "../audit";
import { assertPlanLimit } from "../plan/limits";
import {
  computeInvitationExpiry,
  generateInvitationToken,
  hashInvitationToken,
} from "../invitation-token";

type OnboardingCtx = Ctx & { user: CtxUser; session: CtxSession };

interface OnboardingState {
  step: number;
  skipped: number[];
  completedAt: string | null;
}

function readOnboardingState(settings: unknown): OnboardingState {
  const raw = (settings as { onboarding?: Partial<OnboardingState> } | null)?.onboarding ?? {};
  return {
    step: raw.step ?? 2,
    skipped: raw.skipped ?? [],
    completedAt: raw.completedAt ?? null,
  };
}

async function mutateOrganizationSettings(
  organizationId: string,
  mutate: (settings: Record<string, unknown>) => Record<string, unknown>,
) {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const settings = mutate((org.settings as Record<string, unknown>) ?? {});
  await adminDb.organization.update({
    where: { id: organizationId },
    data: { settings: settings as Prisma.InputJsonValue },
  });
}

async function advanceOnboardingStep(organizationId: string, step: number, markSkipped = false) {
  await mutateOrganizationSettings(organizationId, (settings) => {
    const current = readOnboardingState(settings);
    const skipped = markSkipped ? [...new Set([...current.skipped, step])] : current.skipped;
    return { ...settings, onboarding: { ...current, step: Math.max(current.step, step), skipped } };
  });
}

function requireOrg(ctx: OnboardingCtx): string {
  if (!ctx.session.activeOrganizationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Créez d'abord votre garage (étape 2 de l'assistant).",
    });
  }
  return ctx.session.activeOrganizationId;
}

function requireMembership(ctx: OnboardingCtx): string {
  if (!ctx.membership) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Créez d'abord votre garage (étape 2 de l'assistant).",
    });
  }
  return ctx.membership.id;
}

// RG-M01-16 : couples client (customer + véhicule) de démonstration, marqués source="demo".
const DEMO_CUSTOMERS = [
  {
    displayName: "Kouassi Jean-Marc",
    phone: "+2250700000001",
    plate: "1111AB01",
    make: "Toyota",
    model: "Corolla",
  },
  {
    displayName: "Diabaté Awa",
    phone: "+2250700000002",
    plate: "2222CD01",
    make: "Hyundai",
    model: "i10",
  },
  {
    displayName: "SOTRA Logistique SARL",
    phone: "+2250700000003",
    plate: "3333EF01",
    make: "Renault",
    model: "Master",
  },
];

async function loadDemoDataFor(organizationId: string) {
  const tenantDb = db.forTenant({ organizationId });
  let customers = 0;
  let vehicles = 0;
  for (const demo of DEMO_CUSTOMERS) {
    const customer = await tenantDb.customer.create({
      data: { organizationId, displayName: demo.displayName, phone: demo.phone, source: "demo" },
    });
    customers += 1;
    await tenantDb.vehicle.create({
      data: {
        organizationId,
        customerId: customer.id,
        plate: normalizePlate(demo.plate).plate,
        plateCompact: normalizePlate(demo.plate).plateCompact,
        plateType: normalizePlate(demo.plate).plateType,
        make: demo.make,
        model: demo.model,
      },
    });
    vehicles += 1;
  }
  return { customers, vehicles };
}

async function saveGarageStep(
  ctx: OnboardingCtx,
  data: Extract<SaveOnboardingStepInput, { step: 2 }>["data"],
) {
  const { org, membership } = await adminDb.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: data.name,
        legalName: data.legalName,
        city: data.commune,
        address: data.address,
        phone: data.phone,
        taxRegime: data.taxRegime,
        vatEnabled: data.vatEnabled,
        rccm: data.rccm,
        ncc: data.ncc,
        logoUrl: data.logoUrl,
        settings: {
          onboarding: { step: 2, skipped: [], completedAt: null },
        } as Prisma.InputJsonValue,
      },
    });
    // M14 : slug du lien « Mon espace » (/p/connexion?g={slug}).
    await tx.organization.update({
      where: { id: org.id },
      data: { slug: organizationSlug(org.name, org.id) },
    });
    const membership = await tx.membership.create({
      data: { organizationId: org.id, userId: ctx.user.id, role: "OWNER", siteIds: [] },
    });
    return { org, membership };
  });

  // Semences RG-M01-16 : contenu de référence minimal, à enrichir par M10/M11/M04/M05.
  const tenantDb = db.forTenant({ organizationId: org.id });
  // RG-M10-02 / Annexe A — même jeu que le seed de démonstration (core/onboarding/reminder-defaults).
  await tenantDb.reminderRule.createMany({
    data: defaultReminderRules().map((rule) => ({
      organizationId: org.id,
      type: rule.type,
      name: rule.name,
      isActive: rule.isActive,
      steps: rule.steps as unknown as Prisma.InputJsonValue,
      sendWindow: rule.sendWindow as unknown as Prisma.InputJsonValue,
      conditions: rule.conditions as Prisma.InputJsonValue,
      stopOn: rule.stopOn,
    })),
  });
  await tenantDb.messageTemplate.createMany({
    data: defaultMessageTemplates().map((template) => ({
      organizationId: org.id,
      key: template.key,
      name: template.name,
      channel: template.channel,
      subject: template.subject ?? null,
      body: template.body,
      type: template.type ?? null,
      isActive: true,
      isDefault: true,
    })),
  });
  const inspection = defaultInspectionTemplate();
  await tenantDb.inspectionTemplate.create({
    data: {
      organizationId: org.id,
      name: inspection.name,
      items: inspection.items as unknown as Prisma.InputJsonValue,
      isDefault: true,
    },
  });
  // RG-M04-16 : modèles « Pré-visite technique » et « Inspection achat véhicule d'occasion ».
  for (const template of extraInspectionTemplates()) {
    await tenantDb.inspectionTemplate.create({
      data: {
        organizationId: org.id,
        name: template.name,
        items: template.items as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await tenantDb.laborOperation.createMany({
    data: defaultLaborOperations().map((op) => ({ ...op, organizationId: org.id })),
  });
  await tenantDb.channelConfig.createMany({
    data: defaultChannelConfigs().map((cfg) => ({ ...cfg, organizationId: org.id })),
  });

  await adminDb.session.update({
    where: { id: ctx.session.id },
    data: { activeOrganizationId: org.id, lastActiveAt: new Date() },
  });
  await adminDb.user.update({
    where: { id: ctx.user.id },
    data: { lastActiveOrganizationId: org.id },
  });

  await writeAuditLog({
    organizationId: org.id,
    userId: ctx.user.id,
    membershipId: membership.id,
    action: "organization.created",
    entity: "Organization",
    entityId: org.id,
    after: { name: org.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { nextStep: 3 as const };
}

async function saveWorkshopStep(
  ctx: OnboardingCtx,
  organizationId: string,
  data: Extract<SaveOnboardingStepInput, { step: 3 }>["data"],
) {
  const membershipId = requireMembership(ctx);
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const isRemindersOnly = org.operatingMode === "REMINDERS_ONLY";
  const bays = data.bays ?? (isRemindersOnly ? [] : defaultSiteBays());
  const openingHours = data.openingHours ?? defaultSiteOpeningHours();

  const tenantDb = db.forTenant({ organizationId });
  const existingCode = await tenantDb.site.findFirst({ where: { code: data.code } });
  if (existingCode) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Le code ${data.code} est déjà utilisé par un autre site.`,
    });
  }

  const site = await tenantDb.site.create({
    data: {
      organizationId,
      name: data.name,
      code: data.code,
      openingHours: openingHours as unknown as Prisma.InputJsonValue,
      bays: {
        create: bays.map((bay) => ({ name: bay.name, type: bay.type, organizationId })),
      },
    },
    include: { bays: true },
  });

  if (!isRemindersOnly && data.hourlyRateFcfa !== undefined) {
    await mutateOrganizationSettings(organizationId, (settings) => ({
      ...settings,
      defaultHourlyRateFcfa: data.hourlyRateFcfa,
    }));
  }
  await advanceOnboardingStep(organizationId, 3);

  await adminDb.session.update({
    where: { id: ctx.session.id },
    data: { activeSiteId: site.id },
  });
  await adminDb.user.update({ where: { id: ctx.user.id }, data: { lastActiveSiteId: site.id } });

  await writeAuditLog({
    organizationId,
    userId: ctx.user.id,
    membershipId,
    siteId: site.id,
    action: "site.created",
    entity: "Site",
    entityId: site.id,
    after: site,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { nextStep: 4 as const, siteId: site.id };
}

async function saveModeStep(
  ctx: OnboardingCtx,
  organizationId: string,
  data: Extract<SaveOnboardingStepInput, { step: 4 }>["data"],
) {
  const membershipId = requireMembership(ctx);
  const before = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const after = await adminDb.organization.update({
    where: { id: organizationId },
    data: { operatingMode: data.operatingMode },
  });
  await advanceOnboardingStep(organizationId, 4);

  if (before.operatingMode !== after.operatingMode) {
    await writeAuditLog({
      organizationId,
      userId: ctx.user.id,
      membershipId,
      action: "org.updated",
      entity: "Organization",
      entityId: organizationId,
      before: { operatingMode: before.operatingMode },
      after: { operatingMode: after.operatingMode },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  return { nextStep: 5 as const };
}

async function saveTeamStep(
  ctx: OnboardingCtx,
  organizationId: string,
  data: Extract<SaveOnboardingStepInput, { step: 5 }>["data"],
) {
  if (!data) {
    await advanceOnboardingStep(organizationId, 5, true);
    return { nextStep: 6 as const, invitationIds: [] as string[] };
  }

  const membershipId = requireMembership(ctx);
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const invitationIds: string[] = [];

  for (const invite of data.invitations) {
    await assertPlanLimit(organizationId, "activeMembers");

    const email = invite.email?.toLowerCase().trim();
    const phone = invite.phone?.trim();
    const now = new Date();
    const token = generateInvitationToken();
    const invitation = await adminDb.invitation.create({
      data: {
        organizationId,
        name: invite.name,
        email,
        phone,
        role: invite.role,
        siteIds: [],
        permissions: [],
        tokenHash: hashInvitationToken(token),
        channel: invite.channel,
        status: "PENDING",
        invitedById: membershipId,
        expiresAt: computeInvitationExpiry(now),
      },
    });

    const provider = createConsoleMessagingProvider(invite.channel as MessageChannel);
    const to = invite.channel === "EMAIL" ? email! : phone!;
    await provider.send({
      to,
      channel: invite.channel as MessageChannel,
      body: `Vous êtes invité(e) à rejoindre ${org.name} sur AtelierOS. Lien d'invitation : /invitation/${token}`,
      templateKey: "invitation.created",
      idempotencyKey: `inv:${token}:created`,
    });

    await writeAuditLog({
      organizationId,
      userId: ctx.user.id,
      membershipId,
      action: "member.invited",
      entity: "Invitation",
      entityId: invitation.id,
      after: { name: invitation.name, role: invitation.role },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    invitationIds.push(invitation.id);
  }

  await advanceOnboardingStep(organizationId, 5);
  return { nextStep: 6 as const, invitationIds };
}

async function saveChannelsStep(
  organizationId: string,
  data: Extract<SaveOnboardingStepInput, { step: 6 }>["data"],
) {
  if (!data) {
    await advanceOnboardingStep(organizationId, 6, true);
    return { nextStep: 7 as const, testSent: false };
  }

  const tenantDb = db.forTenant({ organizationId });
  await tenantDb.channelConfig.upsert({
    where: {
      organizationId_channel_provider: {
        organizationId,
        channel: "WHATSAPP",
        provider: data.whatsappProvider,
      },
    },
    create: {
      organizationId,
      channel: "WHATSAPP",
      provider: data.whatsappProvider,
      isActive: true,
      credentials: "{}",
    },
    update: { isActive: true },
  });
  if (data.smsEnabled) {
    await tenantDb.channelConfig.upsert({
      where: {
        organizationId_channel_provider: { organizationId, channel: "SMS", provider: "console" },
      },
      create: {
        organizationId,
        channel: "SMS",
        provider: "console",
        isActive: true,
        credentials: "{}",
      },
      update: { isActive: true },
    });
  }
  if (data.emailEnabled) {
    await tenantDb.channelConfig.upsert({
      where: {
        organizationId_channel_provider: { organizationId, channel: "EMAIL", provider: "console" },
      },
      create: {
        organizationId,
        channel: "EMAIL",
        provider: "console",
        isActive: true,
        credentials: "{}",
      },
      update: { isActive: true },
    });
  }

  let testSent = false;
  if (data.sendTestTo) {
    const provider = createConsoleMessagingProvider("WHATSAPP");
    await provider.send({
      to: data.sendTestTo,
      channel: "WHATSAPP",
      body: "Ceci est un message de test AtelierOS.",
      templateKey: "onboarding.test",
      idempotencyKey: `onboarding:test:${crypto.randomUUID()}`,
    });
    testSent = true;
  }

  await advanceOnboardingStep(organizationId, 6);
  return { nextStep: 7 as const, testSent };
}

async function saveDataStep(
  organizationId: string,
  data: Extract<SaveOnboardingStepInput, { step: 7 }>["data"],
) {
  if (!data || data.choice === "skip") {
    await advanceOnboardingStep(organizationId, 7, !data);
    return { nextStep: 8 as const, counts: null };
  }
  const counts = await loadDemoDataFor(organizationId);
  await advanceOnboardingStep(organizationId, 7);
  return { nextStep: 8 as const, counts };
}

async function saveDoneStep(organizationId: string) {
  const now = new Date();
  await mutateOrganizationSettings(organizationId, (settings) => {
    const current = readOnboardingState(settings);
    return { ...settings, onboarding: { ...current, step: 8, completedAt: now.toISOString() } };
  });
  await adminDb.organization.update({
    where: { id: organizationId },
    data: { onboardingCompletedAt: now },
  });
  return { nextStep: 8 as const };
}

export const onboardingRouter = router({
  get: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.activeOrganizationId) {
      return { step: 2, skipped: [] as number[], data: {} };
    }
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.session.activeOrganizationId },
    });
    const state = readOnboardingState(org.settings);
    return {
      step: state.step,
      skipped: state.skipped,
      data: { operatingMode: org.operatingMode, onboardingCompletedAt: org.onboardingCompletedAt },
    };
  }),

  saveStep: authedProcedure
    .input(saveOnboardingStepInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.step === 2) {
        return saveGarageStep(ctx, input.data);
      }
      const organizationId = requireOrg(ctx);
      switch (input.step) {
        case 3:
          return saveWorkshopStep(ctx, organizationId, input.data);
        case 4:
          return saveModeStep(ctx, organizationId, input.data);
        case 5:
          return saveTeamStep(ctx, organizationId, input.data);
        case 6:
          return saveChannelsStep(organizationId, input.data);
        case 7:
          return saveDataStep(organizationId, input.data);
        case 8:
          return saveDoneStep(organizationId);
      }
    }),

  loadDemoData: authedProcedure.mutation(async ({ ctx }) => {
    const organizationId = requireOrg(ctx);
    const counts = await loadDemoDataFor(organizationId);
    return { counts };
  }),

  purgeDemoData: authedProcedure.mutation(async ({ ctx }) => {
    const organizationId = requireOrg(ctx);
    const tenantDb = db.forTenant({ organizationId });
    const vehicles = await tenantDb.vehicle.deleteMany({ where: { customer: { source: "demo" } } });
    const customers = await tenantDb.customer.deleteMany({ where: { source: "demo" } });
    return { counts: { customers: customers.count, vehicles: vehicles.count } };
  }),
});
