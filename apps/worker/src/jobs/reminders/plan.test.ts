import { DEFAULT_REMINDER_SETTINGS, type ReminderStep, type SendWindow } from "@atelieros/core";
import { describe, expect, it, vi } from "vitest";
import { planOrganizationReminders, type RemindersPlanRepository } from "./plan";
import type {
  CustomerContext,
  NewReminderInput,
  OrganizationContext,
  ReminderCandidate,
  RuleContext,
} from "./types";

const SEND_WINDOW: SendWindow = {
  days: [1, 2, 3, 4, 5, 6],
  from: "08:00",
  to: "19:00",
  preferredTime: "09:00",
};

function step(overrides: Partial<ReminderStep> = {}): ReminderStep {
  return {
    key: "J-30",
    label: "J-30",
    offsetDays: -30,
    templateKey: "vt_j30",
    autoSend: true,
    channels: ["WHATSAPP", "SMS"],
    ...overrides,
  };
}

function rule(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    id: "rule_1",
    type: "INSPECTION",
    steps: [step()],
    sendWindow: SEND_WINDOW,
    conditions: {},
    ...overrides,
  };
}

function customer(overrides: Partial<CustomerContext> = {}): CustomerContext {
  return {
    id: "cust_1",
    type: "INDIVIDUAL",
    deletedAt: null,
    doNotRemind: false,
    remindersConsent: true,
    tags: [],
    displayName: "Jean Kouassi",
    phone: "+2250700000001",
    phone2: null,
    whatsappPhone: null,
    hasWhatsapp: true,
    email: null,
    preferredChannel: null,
    optedOutChannels: [],
    phoneInvalidAt: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    entityId: "veh_1",
    customerId: "cust_1",
    vehicleId: "veh_1",
    anchor: new Date("2026-11-02T00:00:00.000Z"),
    ...overrides,
  };
}

function org(overrides: Partial<OrganizationContext> = {}): OrganizationContext {
  return {
    id: "org_1",
    timezone: "Africa/Abidjan",
    operatingMode: "FULL",
    settings: DEFAULT_REMINDER_SETTINGS,
    ...overrides,
  };
}

interface FakeRepoConfig {
  rules?: RuleContext[];
  candidates?: ReminderCandidate[];
  customer?: CustomerContext;
  existingDedupeKeys?: Set<string>;
  suppressed?: boolean;
  receivableDataAgeHours?: number | null;
}

function createFakeRepo(cfg: FakeRepoConfig = {}): RemindersPlanRepository & {
  created: NewReminderInput[];
} {
  const created: NewReminderInput[] = [];
  const existing = cfg.existingDedupeKeys ?? new Set<string>();
  return {
    created,
    async listActiveRules() {
      return cfg.rules ?? [rule()];
    },
    async listCandidates() {
      const cand = cfg.candidates ?? [candidate()];
      return cand.map((c) => ({ candidate: c, customer: cfg.customer ?? customer() }));
    },
    async listSequenceHistory() {
      return [];
    },
    async isSuppressed() {
      return cfg.suppressed ?? false;
    },
    async reminderExists(_organizationId, dedupeKey) {
      return existing.has(dedupeKey);
    },
    async createReminder(input) {
      created.push(input);
    },
    async expireOverdueApprovals() {
      return 0;
    },
    async reactivateSnoozed() {
      return 0;
    },
    async receivableDataAgeHours() {
      return cfg.receivableDataAgeHours ?? null;
    },
  };
}

// Jour civil exact de la cible du palier J-30 (anchor 02/11 − 30 j = 03/10) : pas de rattrapage.
const NOW = new Date("2026-10-03T14:00:00.000Z");

describe("planOrganizationReminders", () => {
  it("ne crée rien et n'interroge pas les règles si le mode est PAUSED (RG-M10-18)", async () => {
    const repo = createFakeRepo();
    const listActiveRulesSpy = vi.spyOn(repo, "listActiveRules");
    const result = await planOrganizationReminders(
      repo,
      org({ settings: { ...DEFAULT_REMINDER_SETTINGS, approvalMode: "PAUSED" } }),
      NOW,
    );
    expect(result.created).toBe(0);
    expect(listActiveRulesSpy).not.toHaveBeenCalled();
  });

  it("crée une relance PLANNED quand autoSend est vrai et un canal est disponible", async () => {
    const repo = createFakeRepo();
    const result = await planOrganizationReminders(repo, org(), NOW);
    expect(result.created).toBe(1);
    expect(repo.created[0]).toMatchObject({
      status: "PLANNED",
      channel: "WHATSAPP",
      type: "INSPECTION",
      stepKey: "J-30",
    });
  });

  it("exige une validation et ne compte aucun canal si le client n'a ni téléphone ni email (RG-M10-31)", async () => {
    const repo = createFakeRepo({
      customer: customer({ phone: null, whatsappPhone: null, email: null }),
    });
    const result = await planOrganizationReminders(repo, org(), NOW);
    expect(result.created).toBe(1);
    expect(result.skippedNoChannel).toBe(1);
    expect(repo.created[0]).toMatchObject({ status: "NEEDS_APPROVAL", channel: null });
  });

  it("ne recrée pas une relance déjà existante pour la même clé de dédoublonnage", async () => {
    const repo = createFakeRepo({
      existingDedupeKeys: new Set(["INSPECTION:veh_1:2026-11-02:J-30"]),
    });
    const result = await planOrganizationReminders(repo, org(), NOW);
    expect(result.created).toBe(0);
  });

  it("ignore un candidat dont la plaque est en double (RG-M10-30)", async () => {
    const repo = createFakeRepo({ candidates: [candidate({ plateOccurrences: 2 })] });
    const result = await planOrganizationReminders(repo, org(), NOW);
    expect(result.created).toBe(0);
    expect(result.flaggedDataQuality).toBe(1);
  });

  it("ignore un candidat couvert par une suppression active (RG-M10-21)", async () => {
    const repo = createFakeRepo({ suppressed: true });
    const result = await planOrganizationReminders(repo, org(), NOW);
    expect(result.created).toBe(0);
  });

  it("ignore un client inéligible (doNotRemind)", async () => {
    const repo = createFakeRepo({ customer: customer({ doNotRemind: true }) });
    const result = await planOrganizationReminders(repo, org(), NOW);
    expect(result.created).toBe(0);
  });

  it("force NEEDS_APPROVAL pour une créance en REMINDERS_ONLY avec données âgées > maxDataAgeHours (RG-M10-29)", async () => {
    const repo = createFakeRepo({
      rules: [rule({ type: "RECEIVABLE", steps: [step({ key: "J+3", offsetDays: 3 })] })],
      candidates: [
        candidate({
          entityId: "case_1",
          vehicleId: null,
          amount: 50000,
          anchor: new Date("2026-09-30T00:00:00.000Z"),
        }),
      ],
      receivableDataAgeHours: 72,
    });
    const result = await planOrganizationReminders(
      repo,
      org({ operatingMode: "REMINDERS_ONLY" }),
      NOW,
    );
    expect(result.created).toBe(1);
    expect(repo.created[0]?.status).toBe("NEEDS_APPROVAL");
  });

  it("ne crée plus aucune relance de créance au-delà de 7 jours sans synchronisation (RG-M10-29)", async () => {
    const repo = createFakeRepo({
      rules: [rule({ type: "RECEIVABLE", steps: [step({ key: "J+3", offsetDays: 3 })] })],
      candidates: [
        candidate({
          entityId: "case_1",
          vehicleId: null,
          amount: 50000,
          anchor: new Date("2026-09-30T00:00:00.000Z"),
        }),
      ],
      receivableDataAgeHours: 24 * 8,
    });
    const result = await planOrganizationReminders(
      repo,
      org({ operatingMode: "REMINDERS_ONLY" }),
      NOW,
    );
    expect(result.created).toBe(0);
  });

  it("filtre les types de relance hors périmètre de cette tranche", async () => {
    const repo = createFakeRepo({ rules: [rule({ type: "APPOINTMENT" })] });
    const result = await planOrganizationReminders(repo, org(), NOW);
    expect(result.created).toBe(0);
  });
});
