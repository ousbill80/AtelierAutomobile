import { DEFAULT_REMINDER_SETTINGS } from "@atelieros/core";
import type { MessagingProvider } from "@atelieros/integrations";
import { describe, expect, it, vi } from "vitest";
import { dispatchOrganizationReminders, type ReminderMessageSender } from "./dispatch";
import type {
  CustomerContext,
  DueReminder,
  MarkSentInput,
  OrganizationContext,
  RemindersDispatchRepository,
} from "./types";

const NOW = new Date("2026-10-03T09:00:00.000Z");

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

function dueReminder(overrides: Partial<DueReminder> = {}): DueReminder {
  return {
    id: "rem_1",
    type: "INSPECTION",
    stepKey: "J-30",
    templateKey: "vt_j30",
    customerId: "cust_1",
    vehicleId: "veh_1",
    invoiceId: null,
    sequenceKey: "INSPECTION:veh_1:2026-11-02",
    deferCount: 0,
    priority: 4,
    stepChannels: ["WHATSAPP", "SMS"],
    customer: customer(),
    typeCheck: {
      type: "INSPECTION",
      data: {
        plannedInspectionExpiryDate: new Date("2026-11-02T00:00:00.000Z"),
        currentInspectionExpiryDate: new Date("2026-11-02T00:00:00.000Z"),
        vehicleStillOwnedByCustomer: true,
        hasOpenAppointmentOrRepairOrderSinceAnchor: false,
      },
    },
    isEdited: false,
    renderedBody: null,
    editedContextVariables: null,
    freshVariables: { "vehicule.plaque": "3315 KL 01", "vt.dateExpiration": "02/11/2026" },
    templates: {
      WHATSAPP: { body: "VT de {{vehicule.plaque}} expire le {{vt.dateExpiration}}." },
      SMS: { body: "VT {{vehicule.plaque}} expire {{vt.dateExpiration}}." },
    },
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
  due?: DueReminder[];
  suppressed?: boolean;
  antiSpamHistory?: Array<{ recipientKey: string; sentAt: Date; priority: number }>;
}

function createFakeRepo(cfg: FakeRepoConfig = {}) {
  const calls = {
    cancelled: [] as Array<{ id: string; reason: string }>,
    rescheduled: [] as Array<{ id: string; retryAt: Date; reason: string }>,
    deferred: [] as Array<{ id: string; decision: unknown }>,
    movedToCallList: [] as string[],
    backToApproval: [] as Array<{ id: string; reason: string }>,
    sent: [] as MarkSentInput[],
    failed: [] as Array<{ id: string; message: string }>,
  };
  const repo: RemindersDispatchRepository = {
    async recoverStuckQueued() {
      return 0;
    },
    async listDueReminders() {
      return cfg.due ?? [dueReminder()];
    },
    async antiSpamHistory() {
      return (cfg.antiSpamHistory ?? []) as never;
    },
    async isSuppressed() {
      return cfg.suppressed ?? false;
    },
    async cancelReminder(id, reason) {
      calls.cancelled.push({ id, reason });
    },
    async rescheduleReminder(id, retryAt, reason) {
      calls.rescheduled.push({ id, retryAt, reason });
    },
    async deferReminder(id, decision) {
      calls.deferred.push({ id, decision });
    },
    async moveToCallList(id) {
      calls.movedToCallList.push(id);
    },
    async backToApproval(id, reason) {
      calls.backToApproval.push({ id, reason });
    },
    async markSent(input) {
      calls.sent.push(input);
    },
    async markFailed(id, errorMessage) {
      calls.failed.push({ id, message: errorMessage });
    },
  };
  return { repo, calls };
}

function fakeSender(impl?: Partial<MessagingProvider>): ReminderMessageSender {
  const provider: MessagingProvider = {
    channel: "WHATSAPP",
    async send() {
      return { providerMessageId: "console_msg_1" };
    },
    async parseWebhook() {
      return [];
    },
    async verifyWebhook() {
      return true;
    },
    async healthCheck() {
      return { ok: true };
    },
    ...impl,
  };
  return {
    async resolveProvider() {
      return { provider, providerName: "console" };
    },
  };
}

describe("dispatchOrganizationReminders", () => {
  it("n'envoie rien si le mode est PAUSED (RG-M10-18)", async () => {
    const { repo, calls } = createFakeRepo();
    const listSpy = vi.spyOn(repo, "listDueReminders");
    const result = await dispatchOrganizationReminders(
      repo,
      fakeSender(),
      org({ settings: { ...DEFAULT_REMINDER_SETTINGS, approvalMode: "PAUSED" } }),
      NOW,
    );
    expect(result.sent).toBe(0);
    expect(listSpy).not.toHaveBeenCalled();
    expect(calls.sent).toHaveLength(0);
  });

  it("envoie une relance valide et la marque SENT", async () => {
    const { repo, calls } = createFakeRepo();
    const result = await dispatchOrganizationReminders(repo, fakeSender(), org(), NOW);
    expect(result.sent).toBe(1);
    expect(calls.sent).toHaveLength(1);
    expect(calls.sent[0]).toMatchObject({
      id: "rem_1",
      channel: "WHATSAPP",
      to: "+2250700000001",
      renderedBody: "VT de 3315 KL 01 expire le 02/11/2026.",
      provider: "console",
      providerMessageId: "console_msg_1",
    });
  });

  it("annule si la revérification échoue (RG-M10-24)", async () => {
    const { repo, calls } = createFakeRepo({
      due: [
        dueReminder({
          typeCheck: {
            type: "INSPECTION",
            data: {
              plannedInspectionExpiryDate: new Date("2026-11-02T00:00:00.000Z"),
              currentInspectionExpiryDate: new Date("2026-12-01T00:00:00.000Z"),
              vehicleStillOwnedByCustomer: true,
              hasOpenAppointmentOrRepairOrderSinceAnchor: false,
            },
          },
        }),
      ],
    });
    const result = await dispatchOrganizationReminders(repo, fakeSender(), org(), NOW);
    expect(result.cancelled).toBe(1);
    expect(calls.cancelled[0]?.reason).toContain("mise à jour");
  });

  it("replanifie si un paiement est en cours (RECEIVABLE, RG-M10-24.4)", async () => {
    const { repo, calls } = createFakeRepo({
      due: [
        dueReminder({
          type: "RECEIVABLE",
          typeCheck: {
            type: "RECEIVABLE",
            data: {
              currentBalance: 50000,
              minAmount: 2000,
              caseStatus: "OPEN",
              hasPendingPaymentWithinTwoHours: true,
              hasUnallocatedPaymentOrCredit: false,
              dataFreshnessOk: true,
              now: NOW,
            },
          },
        }),
      ],
    });
    const result = await dispatchOrganizationReminders(repo, fakeSender(), org(), NOW);
    expect(result.rescheduled).toBe(1);
    expect(calls.rescheduled).toHaveLength(1);
  });

  it("bascule en liste d'appel si aucun canal n'est utilisable (RG-M10-31)", async () => {
    const { repo, calls } = createFakeRepo({
      due: [dueReminder({ customer: customer({ phone: null, whatsappPhone: null, email: null }) })],
    });
    const result = await dispatchOrganizationReminders(repo, fakeSender(), org(), NOW);
    expect(result.movedToCallList).toBe(1);
    expect(calls.movedToCallList).toEqual(["rem_1"]);
  });

  it("reporte puis abandonne selon le plafond anti-spam (RG-M10-16)", async () => {
    const { repo, calls } = createFakeRepo({
      due: [dueReminder({ priority: 4, deferCount: 3 })],
      antiSpamHistory: [{ recipientKey: "+2250700000001", sentAt: NOW, priority: 4 }],
    });
    const result = await dispatchOrganizationReminders(repo, fakeSender(), org(), NOW);
    expect(result.deferred).toBe(1);
    expect(calls.deferred[0]?.decision).toMatchObject({ action: "SKIPPED" });
  });

  it("bloque l'envoi et revient en validation si une donnée a changé depuis l'édition (RG-M10-25)", async () => {
    const { repo, calls } = createFakeRepo({
      due: [
        dueReminder({
          isEdited: true,
          renderedBody: "Texte modifié à la main.",
          editedContextVariables: { "vt.dateExpiration": "02/11/2026" },
          freshVariables: { "vt.dateExpiration": "15/11/2026", "vehicule.plaque": "3315 KL 01" },
        }),
      ],
    });
    const result = await dispatchOrganizationReminders(repo, fakeSender(), org(), NOW);
    expect(result.blockedByEdit).toBe(1);
    expect(calls.backToApproval).toHaveLength(1);
  });

  it("marque FAILED si l'envoi échoue", async () => {
    const { repo, calls } = createFakeRepo();
    const failingSender = fakeSender({
      async send() {
        throw new Error("Fournisseur indisponible");
      },
    });
    const result = await dispatchOrganizationReminders(repo, failingSender, org(), NOW);
    expect(result.failed).toBe(1);
    expect(calls.failed[0]).toMatchObject({ id: "rem_1", message: "Fournisseur indisponible" });
  });
});
