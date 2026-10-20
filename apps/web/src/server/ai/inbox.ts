// M17 — boîte de réception : classification d'intention (RG-M17-11), brouillon de réponse
// (RG-M17-12) et proposition de créneaux sans IA (US-M17-02). Tout effet externe (envoi,
// RDV, désinscription) reste une suggestion validée par un clic (RG-M17-02) ; seuls
// `Message.intent`, `Conversation.lastIntent`, l'assignation au gérant d'une réclamation et
// les tâches internes sont posés automatiquement (sans effet externe).
import {
  APPOINTMENT_PURPOSE_FR,
  formatFCFA,
  localDateKey,
  normalizeClassification,
  parsePreferredSlotText,
  redactPii,
  classifyIntentByKeywords,
  type AppointmentTypeKey,
  type IntentClassification,
  type MessageIntent,
  type SlotPreference,
} from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  buildIntentMessages,
  buildReplyMessage,
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM,
  intentConsoleOutput,
  intentOutputSchema,
  REPLY_PROMPT_VERSION,
  replyConsoleOutput,
  replyMaxLength,
  replyOutputSchema,
  replySystem,
  type IntentPromptInput,
  type ReplyPromptInput,
} from "@atelieros/integrations";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { asTx, loadOrganization } from "../appointments/service";
import { computeSlotSuggestions } from "../appointments/slotSuggestions";
import { requirePermission } from "../trpc";
import { businessCaller, registerAcceptHandler } from "./accept";
import { getAiService } from "./service";
import { createSuggestion, expireSuggestionsFor } from "./suggestions";

type TenantDb = ReturnType<typeof db.forTenant>;
type ConversationChannel = "WHATSAPP" | "SMS" | "EMAIL";

const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const APPOINTMENT_INTENTS: ReadonlySet<MessageIntent> = new Set(["BOOK_APPOINTMENT", "RESCHEDULE"]);

/** Type de RDV déduit de la relance d'origine (repli RG-M17-08 « suggestion de créneau »). */
function appointmentTypeFor(reminderType: string | null | undefined): AppointmentTypeKey {
  if (reminderType === "INSPECTION") return "INSPECTION_PREP";
  if (reminderType === "RECOMMENDED_WORK") return "REPAIR";
  return "SERVICE";
}

function customerLabel(customer: {
  type: string;
  civility: string | null;
  lastName: string | null;
  displayName: string;
}): string {
  if (customer.type === "COMPANY" || !customer.lastName) return customer.displayName;
  const civility =
    customer.civility === "MME" ? "Mme" : customer.civility === "MLLE" ? "Mlle" : "M.";
  return `${civility} ${customer.lastName}`;
}

async function loadConversationContext(tx: TenantDb, conversationId: string, now: Date) {
  const conversation = await tx.conversation.findFirst({
    where: { id: conversationId },
    include: {
      customer: {
        include: { vehicles: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!conversation) return null;
  const recent = await tx.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, direction: true, body: true, createdAt: true },
  });
  const lastReminder = conversation.customerId
    ? await tx.reminder.findFirst({
        where: {
          customerId: conversation.customerId,
          status: "SENT",
          sentAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { sentAt: "desc" },
        select: { id: true, type: true, stepKey: true, vehicleId: true },
      })
    : null;
  return { conversation, recent: recent.reverse(), lastReminder };
}

async function notifyRoles(
  tx: TenantDb,
  organizationId: string,
  roles: string[],
  data: { type: string; title: string; body?: string; link: string; dedupeKey: string },
): Promise<string[]> {
  const members = await tx.membership.findMany({
    where: { isActive: true, role: { in: roles as never } },
    select: { id: true },
  });
  for (const member of members) {
    const existing = await tx.notification.findFirst({
      where: { membershipId: member.id, dedupeKey: data.dedupeKey },
    });
    if (!existing) {
      await tx.notification.create({
        data: { organizationId, membershipId: member.id, severity: "info", ...data },
      });
    }
  }
  return members.map((m) => m.id);
}

/** RG-M17-11 — classe le message (IA, sinon mots-clés) et pose l'intention. */
export async function classifyInboundMessage(input: {
  organizationId: string;
  messageId: string;
  now?: Date;
}): Promise<(IntentClassification & { isFallback: boolean }) | null> {
  const now = input.now ?? new Date();
  const tx = db.forTenant({ organizationId: input.organizationId });
  const message = await tx.message.findFirst({ where: { id: input.messageId } });
  if (!message?.conversationId || message.direction !== "INBOUND" || !message.body.trim()) {
    return null;
  }
  const context = await loadConversationContext(tx, message.conversationId, now);
  if (!context) return null;
  const org = await loadOrganization(input.organizationId);
  const today = localDateKey(now, org.timezone);

  // RG-M17-04 : téléphones et emails masqués, numérotation partagée entre champs.
  let redaction = redactPii(message.body);
  const history = context.recent
    .filter((m) => m.id !== message.id)
    .slice(-4)
    .map((m) => {
      redaction = redactPii(m.body, redaction);
      return { direction: m.direction as "INBOUND" | "OUTBOUND", body: redaction.text };
    });
  const promptInput: IntentPromptInput = {
    today,
    weekday: WEEKDAYS_FR[new Date(`${today}T12:00:00Z`).getUTCDay()]!,
    message: redactPii(message.body, redaction).text,
    history,
    lastReminder: context.lastReminder
      ? { type: context.lastReminder.type, stepKey: context.lastReminder.stepKey }
      : null,
    vehiclePlate:
      context.conversation.customer?.vehicles.find((v) => v.id === context.lastReminder?.vehicleId)
        ?.plate ??
      context.conversation.customer?.vehicles[0]?.plate ??
      null,
  };

  const result = await getAiService().runStructured({
    feature: "intent_classification",
    promptVersion: INTENT_PROMPT_VERSION,
    ctx: { organizationId: input.organizationId },
    inputRef: `message:${message.id}`,
    system: INTENT_SYSTEM,
    messages: [{ role: "user", content: buildIntentMessages(promptInput) }],
    schema: intentOutputSchema,
    maxTokens: 400,
    piiTokens: redaction.tokens,
    consoleOutput: () => intentConsoleOutput(promptInput),
  });
  // RG-M17-08 : repli par mots-clés (fonction « de fond », poursuivie même hors quota).
  const classification = normalizeClassification(
    result.ok ? (result.output as IntentClassification) : classifyIntentByKeywords(message.body),
  );

  await tx.message.update({ where: { id: message.id }, data: { intent: classification.intent } });
  await tx.conversation.update({
    where: { id: message.conversationId },
    data: { lastIntent: classification.intent },
  });

  // Effets internes (sans effet externe, RG-M17-02 / RG-M17-11).
  const conversation = context.conversation;
  const link = `/messages/${conversation.id}`;
  if (classification.intent === "COMPLAINT" || classification.sentiment === "NEGATIVE") {
    const managers = await notifyRoles(tx, input.organizationId, ["MANAGER", "OWNER"], {
      type: "ai.conversation_priority",
      title: "Réclamation client à traiter",
      body: conversation.customer?.displayName ?? conversation.externalAddress,
      link,
      dedupeKey: `ai.complaint:${message.id}`,
    });
    if (!conversation.assignedToId && managers.length) {
      const manager = await tx.membership.findFirst({
        where: { id: { in: managers }, role: "MANAGER" },
        select: { id: true },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { assignedToId: manager?.id ?? managers[0]! },
      });
    }
  }
  if (classification.intent === "PAYMENT_DONE") {
    await notifyRoles(tx, input.organizationId, ["CASHIER", "ACCOUNTANT"], {
      type: "ai.payment_check",
      title: "Vérifier le paiement annoncé",
      body: conversation.customer?.displayName ?? conversation.externalAddress,
      link,
      dedupeKey: `ai.payment_check:${message.id}`,
    });
  }
  if (classification.intent === "OPT_OUT" && classification.confidence >= 0.9) {
    await createSuggestion(tx, {
      organizationId: input.organizationId,
      interactionId: result.interactionId,
      feature: "optout",
      targetEntity: "conversation",
      targetId: conversation.id,
      payload: { address: conversation.externalAddress, messageId: message.id },
      isFallback: !result.ok,
      now,
    });
  }
  if (classification.intent === "PAYMENT_PROMISE" && conversation.customerId) {
    await createSuggestion(tx, {
      organizationId: input.organizationId,
      interactionId: result.interactionId,
      feature: "promise",
      targetEntity: "conversation",
      targetId: conversation.id,
      payload: {
        customerId: conversation.customerId,
        amount: classification.entities.amount ?? null,
        promisedDate: classification.entities.promisedDate ?? null,
      },
      isFallback: !result.ok,
      now,
    });
  }
  return { ...classification, isFallback: !result.ok };
}

function preferenceFrom(
  classification: Pick<IntentClassification, "entities">,
  text: string,
  now: Date,
  timeZone: string,
): SlotPreference {
  const parsed = parsePreferredSlotText(text, now, timeZone);
  const { date, period } = classification.entities;
  return {
    date: date ?? parsed.date,
    halfDay: period === "MORNING" ? "AM" : period ? "PM" : parsed.halfDay,
    label: parsed.label,
  };
}

/** US-M17-02 / RG-M17-12 — créneaux (sans IA) puis brouillon de réponse (IA, sinon modèle). */
export async function draftReplyForConversation(input: {
  organizationId: string;
  conversationId: string;
  intent?: IntentClassification | null;
  membershipId?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const tx = db.forTenant({ organizationId: input.organizationId });
  const context = await loadConversationContext(tx, input.conversationId, now);
  if (!context) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation introuvable." });
  const { conversation, recent, lastReminder } = context;
  const lastInbound = [...recent].reverse().find((m) => m.direction === "INBOUND");
  if (!lastInbound) return null;
  const org = await loadOrganization(input.organizationId);
  const intent: IntentClassification =
    input.intent ??
    (conversation.lastIntent
      ? {
          intent: conversation.lastIntent as MessageIntent,
          confidence: 1,
          entities: {},
          sentiment: "NEUTRAL",
          needsHuman: false,
        }
      : classifyIntentByKeywords(lastInbound.body));
  const customer = conversation.customer;
  const channel = conversation.channel as ConversationChannel;

  // Créneaux : calculés par le code, jamais par l'IA.
  let slots: { startsAt: string; bayId: string | null; label: string }[] = [];
  let appointmentType: AppointmentTypeKey = appointmentTypeFor(lastReminder?.type);
  const vehicleId = lastReminder?.vehicleId ?? customer?.vehicles[0]?.id ?? null;
  if (customer && APPOINTMENT_INTENTS.has(intent.intent)) {
    const lastAppointment = await tx.appointment.findFirst({
      where: { customerId: customer.id },
      orderBy: { startsAt: "desc" },
      select: { siteId: true },
    });
    const site = await tx.site.findFirst({
      where: lastAppointment ? { id: lastAppointment.siteId } : { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (site) {
      appointmentType = appointmentTypeFor(lastReminder?.type);
      const suggestions = await computeSlotSuggestions(asTx(tx), {
        org,
        site,
        type: appointmentType,
        preference: preferenceFrom(intent, lastInbound.body, now, org.timezone),
        now,
      });
      slots = suggestions.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        bayId: s.bayId,
        label: s.label.replace(/, .*$/, "").replace(/(\d{2}\/\d{2})\/\d{4}/, "$1"),
      }));
    }
  }

  const balanceAgg = customer
    ? await tx.invoice.aggregate({
        where: {
          customerId: customer.id,
          status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
        },
        _sum: { balance: true },
      })
    : null;
  const balance = balanceAgg?._sum.balance ?? 0;
  const upcoming = customer
    ? await tx.appointment.findFirst({
        where: {
          customerId: customer.id,
          startsAt: { gt: now },
          status: { in: ["BOOKED", "CONFIRMED"] },
        },
        orderBy: { startsAt: "asc" },
        select: { startsAt: true },
      })
    : null;

  let redaction = redactPii("");
  const promptInput: ReplyPromptInput = {
    channel,
    customerName: customer ? customerLabel(customer) : null,
    vehicles: (customer?.vehicles ?? []).slice(0, 3).map((v) => ({
      label: `${v.make} ${v.model}`.trim(),
      plate: v.plate,
    })),
    slots: slots.map((s) => ({ label: s.label, purpose: APPOINTMENT_PURPOSE_FR[appointmentType] })),
    // RG-M17-04 : solde transmis seulement si la fonction en a besoin.
    balance: intent.intent === "ASK_BALANCE" && balance > 0 ? formatFCFA(balance) : null,
    upcomingAppointment: upcoming
      ? new Intl.DateTimeFormat("fr-FR", {
          timeZone: org.timezone,
          dateStyle: "short",
          timeStyle: "short",
        }).format(upcoming.startsAt)
      : null,
    siteHours: null,
    intent: intent.intent,
    conversation: recent.slice(-5).map((m) => {
      redaction = redactPii(m.body, redaction);
      return { direction: m.direction as "INBOUND" | "OUTBOUND", body: redaction.text };
    }),
  };

  const result = await getAiService().runStructured({
    feature: "reply_draft",
    promptVersion: REPLY_PROMPT_VERSION,
    ctx: { organizationId: input.organizationId, membershipId: input.membershipId ?? null },
    inputRef: `conversation:${conversation.id}`,
    system: replySystem(channel),
    messages: [{ role: "user", content: buildReplyMessage(promptInput) }],
    schema: replyOutputSchema,
    maxTokens: 600,
    piiTokens: redaction.tokens,
    consoleOutput: () => replyConsoleOutput(promptInput),
  });
  // Repli RG-M17-08 : réponse type construite par le code à partir des mêmes faits.
  const body = (result.ok ? result.output.body : replyConsoleOutput(promptInput).body).slice(
    0,
    replyMaxLength(channel),
  );

  const reply = await createSuggestion(tx, {
    organizationId: input.organizationId,
    interactionId: result.interactionId,
    feature: "reply_draft",
    targetEntity: "conversation",
    targetId: conversation.id,
    payload: { body, channel, intent: intent.intent, reason: result.ok ? null : result.reason },
    isFallback: !result.ok,
    now,
  });
  const slot =
    slots.length && customer
      ? await createSuggestion(tx, {
          organizationId: input.organizationId,
          interactionId: null,
          feature: "slot",
          targetEntity: "conversation",
          targetId: conversation.id,
          payload: {
            customerId: customer.id,
            vehicleId,
            type: appointmentType,
            reminderId: lastReminder?.id ?? null,
            slots,
          },
          isFallback: true, // calcul déterministe (RG-M17-02 : pas d'IA dans le choix du créneau)
          now,
        })
      : null;
  return { reply, slot };
}

/**
 * Point d'entrée appelé à la réception d'un message (RG-M11-20) : classification puis
 * brouillon. Ne lève jamais : une panne IA ne doit pas faire échouer le webhook.
 */
export async function processInboundAi(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  /** Horloge injectable (tests). */
  now?: Date;
}): Promise<void> {
  try {
    const tx = db.forTenant({ organizationId: input.organizationId });
    // §11 : nouveau message avant envoi → les suggestions en attente sont périmées.
    await expireSuggestionsFor(tx, "conversation", input.conversationId);
    const intent = await classifyInboundMessage(input);
    if (!intent) return;
    await draftReplyForConversation({ ...input, intent });
  } catch (error) {
    console.error("M17 : traitement IA du message entrant échoué", {
      messageId: input.messageId,
      error: error instanceof Error ? error.message : "inconnue",
    });
  }
}

// ── Procédures tRPC ──

export const inboxProcedures = {
  /** §8 `ai.suggestReply` — (re)génère le brouillon et les créneaux d'une conversation. */
  suggestReply: requirePermission("ai:use", "message:send")
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tx = db.forTenant({ organizationId: ctx.organizationId });
      const conversation = await tx.conversation.findFirst({ where: { id: input.conversationId } });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation introuvable." });
      }
      const drafted = await draftReplyForConversation({
        organizationId: ctx.organizationId,
        conversationId: conversation.id,
        membershipId: ctx.membership.id,
      });
      if (!drafted) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Aucun message du client auquel répondre.",
        });
      }
      return drafted;
    }),
};

// ── Acceptation : la procédure métier normale s'exécute (permissions, audit) ──

const replyEditSchema = z.object({ body: z.string().trim().min(1).max(4096) }).partial();

registerAcceptHandler("reply_draft", {
  permissions: ["message:send"],
  async run({ ctx, suggestion, editedPayload }) {
    const payload = suggestion.payload as { body: string };
    const edited = replyEditSchema.parse(editedPayload ?? {});
    const body = edited.body ?? payload.body;
    const caller = await businessCaller(ctx);
    const message = await caller.messaging.conversations.reply({
      conversationId: suggestion.targetId!,
      body,
    });
    return { result: { messageId: message?.id ?? null }, original: payload.body, final: body };
  },
});

const slotChoiceSchema = z.object({ index: z.number().int().min(0).max(9) });

registerAcceptHandler("slot", {
  permissions: ["appointment:create"],
  async run({ ctx, suggestion, editedPayload }) {
    const payload = suggestion.payload as {
      customerId: string;
      vehicleId: string | null;
      type: AppointmentTypeKey;
      reminderId: string | null;
      slots: { startsAt: string; bayId: string | null; label: string }[];
    };
    const { index } = slotChoiceSchema.parse(editedPayload ?? { index: 0 });
    const slot = payload.slots[index];
    if (!slot) throw new TRPCError({ code: "BAD_REQUEST", message: "Créneau introuvable." });
    const caller = await businessCaller(ctx);
    const created = await caller.appointment.create({
      customerId: payload.customerId,
      vehicleId: payload.vehicleId,
      type: payload.type,
      startsAt: new Date(slot.startsAt),
      bayId: slot.bayId,
      // US-M17-02 : source WHATSAPP (ou canal de la conversation), relance d'origine liée.
      source: "WHATSAPP",
      reminderId: payload.reminderId,
      notifyCustomer: true,
    });
    return { result: { appointmentId: created.appointment.id, label: slot.label } };
  },
});

registerAcceptHandler("optout", {
  permissions: ["optout:manage"],
  async run({ ctx, suggestion }) {
    const payload = suggestion.payload as { address: string };
    const caller = await businessCaller(ctx);
    const optOut = await caller.optOut.add({
      address: payload.address,
      reason: "Demande du client détectée par l'assistant, validée par un conseiller.",
    });
    return { result: { optOutId: optOut.id } };
  },
});
