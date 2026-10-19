import { TRPCError } from "@trpc/server";
import { createConsoleMessagingProvider, defaultOutbox } from "@atelieros/integrations";
import {
  buildAnchorChangedSuppression,
  buildAppointmentSuppressions,
  buildStopSequenceSuppression,
  customerSalutation,
  describeDueCountdown,
  isSuppressed as checkSuppressed,
  renderTemplate,
  resolveReminderChannels,
  revalidateBeforeSend,
  type ReminderChannel,
  type ReminderStep,
  type ReminderType,
  type RevalidateTypeInput,
  type TemplateVariables,
} from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  approveRemindersInputSchema,
  createManualReminderInputSchema,
  dueDatesInputSchema,
  getReminderInputSchema,
  markAppointmentTakenInputSchema,
  markInspectionDoneInputSchema,
  markWaLinkSentInputSchema,
  previewReminderInputSchema,
  reminderQueueInputSchema,
  reminderStatsInputSchema,
  retryReminderInputSchema,
  skipRemindersInputSchema,
  snoozeRemindersInputSchema,
  updateReminderInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

// RG-M10-§10 : CASHIER ne valide les créances qu'aux paliers antérieurs à J+30 (restriction trop
// fine pour le catalogue de permissions — vérifiée ici, à chaque relance individuellement).
const CASHIER_RECEIVABLE_STEP_LIMIT_DAYS = 30;

function assertCanApprove(
  ctx: { permissions: Set<string>; membership: { role: string } },
  reminder: { type: string; dueDate: Date; scheduledFor: Date },
): void {
  if (!ctx.permissions.has("reminder:approve")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Vous n'avez pas le droit de valider les relances.",
    });
  }
  if (reminder.type === "RECEIVABLE") {
    if (!ctx.permissions.has("receivable:collect")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Vous n'avez pas le droit de valider les relances de créances.",
      });
    }
    if (ctx.membership.role === "CASHIER") {
      const offsetDays = Math.round(
        (reminder.dueDate.getTime() - reminder.scheduledFor.getTime()) / 86_400_000,
      );
      if (Math.abs(offsetDays) >= CASHIER_RECEIVABLE_STEP_LIMIT_DAYS) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Les caissiers ne valident que les relances de créances antérieures à J+30.",
        });
      }
    }
  }
}

type TenantDb = ReturnType<typeof db.forTenant>;

/** Résout le `templateKey` du palier d'une relance depuis `ReminderRule.steps` (JSON). */
function templateKeyFor(rule: { steps: unknown }, stepKey: string): string | null {
  const steps = (rule.steps as ReminderStep[] | null) ?? [];
  return steps.find((s) => s.key === stepKey)?.templateKey ?? null;
}

/**
 * RG-M10-12 — canaux déjà en liste d'exclusion (`OptOut`) pour les adresses de ce client.
 * `channel: null` en base = exclusion de tous les canaux pour cette adresse.
 */
async function loadOptedOutChannels(
  tenantDb: TenantDb,
  customer: {
    phone: string | null;
    phone2: string | null;
    whatsappPhone: string | null;
    email: string | null;
  },
): Promise<ReminderChannel[]> {
  const addresses = [
    customer.phone,
    customer.phone2,
    customer.whatsappPhone,
    customer.email,
  ].filter((a): a is string => Boolean(a));
  if (addresses.length === 0) return [];
  const rows = await tenantDb.optOut.findMany({ where: { address: { in: addresses } } });
  if (rows.some((r) => r.channel === null)) return ["WHATSAPP", "SMS", "EMAIL"];
  return rows.map((r) => r.channel as ReminderChannel);
}

/** Construit le résultat type-spécifique de `revalidateBeforeSend` (RG-M10-24.2 à .7) avec des données fraîches. */
async function buildTypeCheck(
  tenantDb: TenantDb,
  reminder: {
    type: string;
    dueDate: Date;
    vehicleId: string | null;
    invoiceId: string | null;
    appointmentId: string | null;
    customerId: string;
  },
  now: Date,
): Promise<RevalidateTypeInput> {
  switch (reminder.type) {
    case "INSPECTION": {
      const vehicle = reminder.vehicleId
        ? await tenantDb.vehicle.findFirst({ where: { id: reminder.vehicleId } })
        : null;
      const hasOpen = reminder.vehicleId
        ? (await tenantDb.appointment.count({
            where: { vehicleId: reminder.vehicleId, status: { in: ["BOOKED", "CONFIRMED"] } },
          })) > 0
        : false;
      return {
        type: "INSPECTION",
        data: {
          plannedInspectionExpiryDate: reminder.dueDate,
          currentInspectionExpiryDate: vehicle?.inspectionExpiryDate ?? null,
          vehicleStillOwnedByCustomer: vehicle ? vehicle.customerId === reminder.customerId : false,
          hasOpenAppointmentOrRepairOrderSinceAnchor: hasOpen,
        },
      };
    }
    case "SERVICE": {
      const vehicle = reminder.vehicleId
        ? await tenantDb.vehicle.findFirst({ where: { id: reminder.vehicleId } })
        : null;
      return {
        type: "SERVICE",
        data: {
          plannedServiceDueDate: reminder.dueDate,
          currentServiceDueDate: vehicle?.nextServiceDueDate ?? null,
        },
      };
    }
    case "RECEIVABLE": {
      const invoice = reminder.invoiceId
        ? await tenantDb.invoice.findFirst({ where: { id: reminder.invoiceId } })
        : null;
      const collectionCase = await tenantDb.collectionCase.findFirst({
        where: { customerId: reminder.customerId },
      });
      const caseStatus =
        collectionCase?.status === "CLOSED_PAID" || collectionCase?.status === "CLOSED_WRITTEN_OFF"
          ? "CLOSED"
          : (collectionCase?.status ?? "OPEN");
      return {
        type: "RECEIVABLE",
        data: {
          currentBalance: invoice?.balance ?? 0,
          minAmount: 1,
          caseStatus,
          hasPendingPaymentWithinTwoHours: false,
          hasUnallocatedPaymentOrCredit: false,
          dataFreshnessOk: true,
          now,
        },
      };
    }
    case "APPOINTMENT": {
      const appointment = reminder.appointmentId
        ? await tenantDb.appointment.findFirst({ where: { id: reminder.appointmentId } })
        : null;
      const status =
        appointment?.status === "BOOKED" || appointment?.status === "CONFIRMED"
          ? appointment.status
          : "CANCELLED";
      return {
        type: "APPOINTMENT",
        data: {
          status,
          plannedStartsAt: reminder.dueDate,
          currentStartsAt: appointment?.startsAt ?? null,
        },
      };
    }
    case "QUOTE_FOLLOWUP": {
      // Suivi de devis : pas de quoteId direct sur Reminder, revérification limitée au client (RG-M10-24.1).
      return { type: "QUOTE_FOLLOWUP", data: { status: "SENT" } };
    }
    default:
      return { type: reminder.type as "INSURANCE_EXPIRY" | "SATISFACTION" };
  }
}

interface GarageInfo {
  nom: string;
  telephone: string;
  adresse: string;
  horaires: string;
}

async function loadGarageInfo(organizationId: string): Promise<GarageInfo> {
  const org = await db
    .forTenant({ organizationId })
    .site.findFirst({ orderBy: { createdAt: "asc" } });
  return {
    nom: org?.name ?? "Votre garage",
    telephone: org?.phone ?? "",
    adresse: org?.address ?? "",
    horaires: "",
  };
}

/** Variables à plat (`client.salutation`, `vehicule.plaque`, …) pour `renderTemplate`. */
function buildVariables(input: {
  customer: {
    type: "INDIVIDUAL" | "COMPANY";
    civility: string | null;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    displayName: string;
  };
  vehicle?: { make: string; model: string; plate: string } | null;
  garage: GarageInfo;
  dueDate?: Date | null;
  today: Date;
}): TemplateVariables {
  const vars: TemplateVariables = {
    "client.salutation": customerSalutation({
      type: input.customer.type,
      civility: input.customer.civility as "M" | "MME" | "MLLE" | null,
      firstName: input.customer.firstName,
      lastName: input.customer.lastName,
      companyName: input.customer.companyName,
      displayName: input.customer.displayName,
    }),
    "garage.nom": input.garage.nom,
    "garage.telephone": input.garage.telephone,
    "garage.adresse": input.garage.adresse,
    "garage.horaires": input.garage.horaires,
  };
  if (input.vehicle) {
    vars["vehicule.marque"] = input.vehicle.make;
    vars["vehicule.modele"] = input.vehicle.model;
    vars["vehicule.plaque"] = input.vehicle.plate;
  }
  if (input.dueDate) {
    vars["vt.dateExpiration"] = input.dueDate.toLocaleDateString("fr-FR");
    vars["revision.dateEcheance"] = input.dueDate.toLocaleDateString("fr-FR");
    vars["vt.joursRestants"] = String(
      Math.max(0, Math.round((input.dueDate.getTime() - input.today.getTime()) / 86_400_000)),
    );
  }
  return vars;
}

const TAB_FILTER: Record<string, { status: string[]; channelNull?: boolean }> = {
  NEEDS_APPROVAL: { status: ["NEEDS_APPROVAL"], channelNull: false },
  CALL_LIST: { status: ["NEEDS_APPROVAL"], channelNull: true },
  PLANNED_TODAY: { status: ["PLANNED"] },
  SENT_TODAY: { status: ["SENT"] },
  FAILED: { status: ["FAILED"] },
  EXPIRED: { status: ["SKIPPED", "CANCELLED"] },
};

export const remindersRouter = router({
  queue: requirePermission("reminder:read")
    .input(reminderQueueInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      function whereForTab(tab: string): Record<string, unknown> {
        const base = TAB_FILTER[tab] ?? (TAB_FILTER.NEEDS_APPROVAL as { status: string[] });
        const where: Record<string, unknown> = { status: { in: base.status } };
        if (base.channelNull === true) where.channel = null;
        if (base.channelNull === false) where.channel = { not: null };
        if (tab === "PLANNED_TODAY") where.scheduledFor = { gte: startOfDay, lt: endOfDay };
        if (tab === "SENT_TODAY") where.sentAt = { gte: startOfDay, lt: endOfDay };
        if (input.types?.length) where.type = { in: input.types };
        if (input.channels?.length) where.channel = { in: input.channels };
        return where;
      }

      const tabKeys = Object.keys(TAB_FILTER);
      const [items, ...counts] = await Promise.all([
        tenantDb.reminder.findMany({
          where: whereForTab(input.tab),
          include: { customer: true, vehicle: true, invoice: true },
          orderBy: [{ priority: "asc" }, { scheduledFor: "asc" }],
          take: input.limit,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        }),
        ...tabKeys.map((tab) => tenantDb.reminder.count({ where: whereForTab(tab) })),
      ]);

      const countsByTab: Record<string, number> = {};
      tabKeys.forEach((tab, i) => {
        countsByTab[tab] = counts[i] as number;
      });

      return {
        items: items.map((r) => ({
          id: r.id,
          type: r.type,
          stepKey: r.stepKey,
          status: r.status,
          channel: r.channel,
          scheduledFor: r.scheduledFor,
          dueDate: r.dueDate,
          priority: r.priority,
          isCatchUp: r.isCatchUp,
          customer: {
            id: r.customer.id,
            displayName: r.customer.displayName,
            type: r.customer.type,
          },
          vehicle: r.vehicle
            ? {
                id: r.vehicle.id,
                make: r.vehicle.make,
                model: r.vehicle.model,
                plate: r.vehicle.plate,
              }
            : null,
          countdown: describeDueCountdown(r.dueDate, startOfDay),
          amount: r.invoice?.balance ?? null,
        })),
        counts: countsByTab,
        nextCursor: items.length === input.limit ? (items[items.length - 1]?.id ?? null) : null,
      };
    }),

  get: requirePermission("reminder:read")
    .input(getReminderInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminder = await tenantDb.reminder.findFirstOrThrow({
        where: { id: input.id },
        include: { customer: true, vehicle: true, invoice: true, rule: true },
      });
      const history = reminder.sequenceKey
        ? await tenantDb.reminder.findMany({
            where: { sequenceKey: reminder.sequenceKey },
            orderBy: { createdAt: "asc" },
            select: { id: true, stepKey: true, status: true, sentAt: true, channel: true },
          })
        : [];
      return { reminder, history };
    }),

  preview: requirePermission("reminder:read")
    .input(previewReminderInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminder = await tenantDb.reminder.findFirstOrThrow({
        where: { id: input.id },
        include: { customer: true, vehicle: true, rule: true },
      });
      const key = templateKeyFor(reminder.rule, reminder.stepKey);
      const template = key
        ? await tenantDb.messageTemplate.findFirst({
            where: { channel: input.channel, isActive: true, key },
          })
        : null;
      const garage = await loadGarageInfo(ctx.organizationId);
      const vars = buildVariables({
        customer: reminder.customer,
        vehicle: reminder.vehicle,
        garage,
        dueDate: reminder.dueDate,
        today: new Date(),
      });
      const body =
        reminder.editedBody && reminder.renderedBody
          ? reminder.renderedBody
          : template
            ? renderTemplate(template.body, vars)
            : "";
      const subject = template?.subject ? renderTemplate(template.subject, vars) : null;
      const chars = body.length;
      return {
        body,
        subject,
        sms:
          input.channel === "SMS"
            ? { chars, segments: Math.max(1, Math.ceil(chars / 160)), encoding: "GSM-7" as const }
            : undefined,
      };
    }),

  approve: requirePermission("reminder:approve")
    .input(approveRemindersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      let queued = 0;
      let movedToCallList = 0;
      const cancelled: Array<{ id: string; reason: string }> = [];

      for (const id of input.ids) {
        const reminder = await tenantDb.reminder.findFirst({
          where: { id },
          include: { customer: true, vehicle: true, rule: true },
        });
        if (!reminder) {
          cancelled.push({ id, reason: "Relance introuvable." });
          continue;
        }
        if (reminder.status !== "NEEDS_APPROVAL" && reminder.status !== "PLANNED") {
          cancelled.push({ id, reason: "Déjà traitée." });
          continue;
        }

        assertCanApprove(ctx, reminder);

        const suppressions = reminder.sequenceKey
          ? await tenantDb.reminderSuppression.findMany({
              where: {
                OR: [
                  { sequenceKey: reminder.sequenceKey },
                  { customerId: reminder.customerId, type: reminder.type },
                  reminder.vehicleId
                    ? { vehicleId: reminder.vehicleId, type: reminder.type }
                    : { id: "__none__" },
                ],
              },
            })
          : [];
        const hasActiveSuppression = reminder.sequenceKey
          ? checkSuppressed(
              {
                sequenceKey: reminder.sequenceKey,
                customerId: reminder.customerId,
                vehicleId: reminder.vehicleId,
                // RECOMMENDED_WORK/CUSTOM (enum Prisma) ne sont pas encore couverts par le moteur
                // M10 (RG-M10-01 à 24 ne listent que 8 types) — cast sûr, aucune ReminderRule de ce
                // type n'est créée par ce module.
                type: reminder.type as ReminderType,
              },
              suppressions.map((s) => ({ ...s, type: s.type as ReminderType | null })),
              now,
            )
          : false;

        const typeCheck = await buildTypeCheck(tenantDb, reminder, now);
        const outcome = revalidateBeforeSend(
          {
            deletedAt: reminder.customer.deletedAt,
            remindersConsent: reminder.customer.remindersConsent,
            doNotRemind: reminder.customer.doNotRemind,
            isOptedOut: reminder.customer.optedOutAt != null,
            hasActiveSuppression,
            isTransactional: reminder.type === "APPOINTMENT",
          },
          typeCheck,
        );

        if (!outcome.ok) {
          if (outcome.outcome === "CANCELLED") {
            await tenantDb.reminder.update({
              where: { id },
              data: { status: "CANCELLED", skippedReason: outcome.reason },
            });
          } else {
            await tenantDb.reminder.update({
              where: { id },
              data: { scheduledFor: outcome.retryAt },
            });
          }
          cancelled.push({ id, reason: outcome.reason });
          continue;
        }

        const optedOutChannels = await loadOptedOutChannels(tenantDb, reminder.customer);
        const steps = (reminder.rule.steps as ReminderStep[] | null) ?? [];
        const step = steps.find((s) => s.key === reminder.stepKey);
        const phoneE164 = reminder.customer.phoneInvalidAt
          ? null
          : (reminder.customer.whatsappPhone ??
            reminder.customer.phone ??
            reminder.customer.phone2 ??
            null);
        const channels = resolveReminderChannels({
          preferredChannel: reminder.customer.preferredChannel,
          stepChannels:
            step?.channels ?? (reminder.channel ? [reminder.channel as ReminderChannel] : []),
          hasWhatsapp: reminder.customer.hasWhatsapp,
          phoneE164,
          email: reminder.customer.email,
          optedOutChannels,
        });

        if (channels.length === 0) {
          await tenantDb.reminder.update({
            where: { id },
            data: { status: "NEEDS_APPROVAL", channel: null },
          });
          movedToCallList += 1;
          continue;
        }

        const channel = (reminder.channel as ReminderChannel | null) ?? channels[0]!;
        const to = channel === "EMAIL" ? reminder.customer.email : phoneE164;
        if (!to) {
          await tenantDb.reminder.update({
            where: { id },
            data: { status: "NEEDS_APPROVAL", channel: null },
          });
          movedToCallList += 1;
          continue;
        }

        const templateKey = templateKeyFor(reminder.rule, reminder.stepKey);
        const template = templateKey
          ? await tenantDb.messageTemplate.findFirst({
              where: { channel, isActive: true, key: templateKey },
            })
          : null;
        if (!template && !(reminder.editedBody && reminder.renderedBody)) {
          await tenantDb.reminder.update({
            where: { id },
            data: {
              status: "FAILED",
              skippedReason: `Aucun modèle de message actif pour le canal ${channel}.`,
            },
          });
          continue;
        }

        const garage = await loadGarageInfo(ctx.organizationId);
        const vars = buildVariables({
          customer: reminder.customer,
          vehicle: reminder.vehicle,
          garage,
          dueDate: reminder.dueDate,
          today: now,
        });
        const body =
          reminder.editedBody && reminder.renderedBody
            ? reminder.renderedBody
            : renderTemplate(template!.body, vars);
        const subject = template?.subject ? renderTemplate(template.subject, vars) : null;

        try {
          const provider = createConsoleMessagingProvider(channel, defaultOutbox);
          const sendResult = await provider.send({
            to,
            channel,
            body,
            templateKey: templateKey ?? undefined,
          });
          await tenantDb.reminder.update({
            where: { id },
            data: {
              status: "SENT",
              channel,
              renderedBody: body,
              renderedSubject: subject,
              sentAt: now,
              approvedById: ctx.membership.id,
              approvedAt: now,
            },
          });
          void sendResult;
          queued += 1;
        } catch (err) {
          await tenantDb.reminder.update({
            where: { id },
            data: {
              status: "FAILED",
              skippedReason: err instanceof Error ? err.message : "Erreur d'envoi inconnue.",
            },
          });
        }
      }

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "reminder.approved",
        entity: "Reminder",
        entityId: input.ids.join(","),
        after: { queued, movedToCallList, cancelled },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { queued, scheduled: 0, movedToCallList, cancelled };
    }),

  update: requirePermission("reminder:approve")
    .input(updateReminderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.reminder.findFirstOrThrow({ where: { id: input.id } });
      const after = await tenantDb.reminder.update({
        where: { id: input.id },
        data: {
          renderedBody: input.body ?? before.renderedBody,
          renderedSubject: input.subject ?? before.renderedSubject,
          channel: input.channel ?? before.channel,
          editedBody: true,
          editedById: ctx.membership.id,
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "reminder.updated",
        entity: "Reminder",
        entityId: input.id,
        before,
        after,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return after;
    }),

  snooze: requirePermission("reminder:approve")
    .input(snoozeRemindersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await tenantDb.reminder.updateMany({
        where: { id: { in: input.ids }, status: { in: ["NEEDS_APPROVAL", "PLANNED"] } },
        data: { status: "SNOOZED", snoozedUntil: input.until },
      });
      return { updated: result.count };
    }),

  skip: requirePermission("reminder:approve")
    .input(skipRemindersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminders = await tenantDb.reminder.findMany({ where: { id: { in: input.ids } } });

      const result = await tenantDb.reminder.updateMany({
        where: { id: { in: input.ids } },
        data: { status: "SKIPPED", skippedReason: input.reason },
      });

      if (input.stopSequence) {
        for (const reminder of reminders) {
          if (!reminder.sequenceKey) continue;
          const suppression = buildStopSequenceSuppression(reminder.sequenceKey);
          await tenantDb.reminderSuppression.create({
            data: {
              organizationId: ctx.organizationId,
              sequenceKey: suppression.sequenceKey,
              until: suppression.until,
              reason: input.reason,
              source: "staff",
              createdById: ctx.membership.id,
            },
          });
        }
      }

      return { updated: result.count };
    }),

  retry: requirePermission("reminder:approve")
    .input(retryReminderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.reminder.findFirstOrThrow({ where: { id: input.id } });
      if (before.status !== "FAILED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seule une relance en échec peut être réessayée.",
        });
      }
      return tenantDb.reminder.update({
        where: { id: input.id },
        data: { status: "PLANNED", scheduledFor: new Date(), skippedReason: null },
      });
    }),

  createManual: requirePermission("reminder:approve")
    .input(createManualReminderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const rule = await tenantDb.reminderRule.findFirst({ where: { type: input.type } });
      if (!rule) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Aucune règle de relance « ${input.type} » configurée pour créer une relance manuelle.`,
        });
      }
      const now = new Date();
      const dedupeKey = `MANUAL:${input.customerId}:${input.type}:${now.getTime()}`;

      let renderedBody = input.body ?? null;
      let channel = input.channel ?? null;
      if (!renderedBody && input.templateKey && input.channel) {
        const template = await tenantDb.messageTemplate.findFirst({
          where: { key: input.templateKey, channel: input.channel, isActive: true },
        });
        if (template) {
          const customer = await tenantDb.customer.findFirstOrThrow({
            where: { id: input.customerId },
          });
          const vehicle = input.vehicleId
            ? await tenantDb.vehicle.findFirst({ where: { id: input.vehicleId } })
            : null;
          const garage = await loadGarageInfo(ctx.organizationId);
          renderedBody = renderTemplate(
            template.body,
            buildVariables({ customer, vehicle, garage, dueDate: now, today: now }),
          );
          channel = input.channel;
        }
      }

      const reminder = await tenantDb.reminder.create({
        data: {
          organizationId: ctx.organizationId,
          ruleId: rule.id,
          type: input.type,
          stepKey: "MANUAL",
          customerId: input.customerId,
          vehicleId: input.vehicleId ?? null,
          invoiceId: input.invoiceId ?? null,
          dueDate: now,
          scheduledFor: now,
          status: "PLANNED",
          channel,
          renderedBody,
          editedBody: Boolean(renderedBody),
          editedById: renderedBody ? ctx.membership.id : null,
          dedupeKey,
          priority: 5,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "reminder.created_manual",
        entity: "Reminder",
        entityId: reminder.id,
        after: reminder,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return reminder;
    }),

  markWaLinkSent: requirePermission("reminder:approve")
    .input(markWaLinkSentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.reminder.update({
        where: { id: input.id },
        data: {
          status: "SENT",
          channel: "WHATSAPP",
          sentAt: new Date(),
          approvedById: ctx.membership.id,
        },
      });
    }),

  dueDates: requirePermission("reminder:read")
    .input(dueDatesInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const in7 = new Date(now.getTime() + 7 * 86_400_000);
      const in30 = new Date(now.getTime() + 30 * 86_400_000);

      const dateField =
        input.kind === "INSPECTION"
          ? "inspectionExpiryDate"
          : input.kind === "SERVICE"
            ? "nextServiceDueDate"
            : "insuranceExpiryDate";

      const where: Record<string, unknown> = { deletedAt: null, [dateField]: { not: null } };
      switch (input.filter) {
        case "DUE_SOON_7":
          where[dateField] = { gte: now, lte: in7 };
          break;
        case "DUE_SOON_30":
          where[dateField] = { gte: now, lte: in30 };
          break;
        case "OVERDUE":
          where[dateField] = { lt: now };
          break;
        case "UPCOMING":
          where[dateField] = { gt: in30 };
          break;
        case "INCOMPLETE_DATA":
          where[dateField] = null;
          break;
        case "SUSPECT_DATE":
          where.dataQualityFlags = { has: "inspection_date_suspect" };
          break;
        default:
          break;
      }

      const vehicles = await tenantDb.vehicle.findMany({
        where,
        include: { customer: true },
        orderBy: { [dateField]: "asc" },
        take: input.limit,
      });

      return {
        items: vehicles.map((v) => ({
          vehicleId: v.id,
          plate: v.plate,
          make: v.make,
          model: v.model,
          customer: { id: v.customer.id, displayName: v.customer.displayName },
          dueDate:
            v[dateField as "inspectionExpiryDate" | "nextServiceDueDate" | "insuranceExpiryDate"],
          lastDate: v.inspectionLastDate ?? v.lastServiceDate ?? null,
          countdown: v[dateField as "inspectionExpiryDate"]
            ? describeDueCountdown(v[dateField as "inspectionExpiryDate"] as Date, now)
            : null,
          isSuspect: v.dataQualityFlags.includes("inspection_date_suspect"),
        })),
      };
    }),

  markAppointmentTaken: requirePermission("reminder:approve")
    .input(markAppointmentTakenInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.findFirstOrThrow({ where: { id: input.vehicleId } });

      let appointment = null;
      if (input.createAppointment) {
        const site = await tenantDb.site.findFirstOrThrow({ where: { isActive: true } });
        const startsAt = input.date ?? new Date();
        const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
        appointment = await tenantDb.appointment.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: site.id,
            customerId: vehicle.customerId,
            vehicleId: vehicle.id,
            startsAt,
            endsAt,
            type: "INSPECTION_PREP",
            status: "BOOKED",
            source: "STAFF",
          },
        });
      }

      const suppressions = buildAppointmentSuppressions({
        vehicleId: input.vehicleId,
        startsAt: input.date ?? new Date(),
        source: "appointment",
      });
      for (const s of suppressions) {
        await tenantDb.reminderSuppression.create({
          data: {
            organizationId: ctx.organizationId,
            vehicleId: s.vehicleId,
            type: s.type,
            until: s.until,
            reason: "RDV pris",
            source: "appointment",
            createdById: ctx.membership.id,
          },
        });
      }

      return { appointment };
    }),

  markInspectionDone: requirePermission("reminder:approve")
    .input(markInspectionDoneInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.vehicle.findFirstOrThrow({ where: { id: input.vehicleId } });

      const pendingSequences = await tenantDb.reminder.findMany({
        where: {
          vehicleId: input.vehicleId,
          type: "INSPECTION",
          status: { in: ["PLANNED", "NEEDS_APPROVAL"] },
        },
        select: { id: true, sequenceKey: true },
      });

      const after = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          inspectionLastDate: input.lastDate ?? new Date(),
          inspectionExpiryDate: input.expiryDate,
          inspectionCenter: input.center ?? before.inspectionCenter,
          inspectionExpiryEstimated: false,
          dataQualityFlags: before.dataQualityFlags.filter((f) => f !== "inspection_date_suspect"),
        },
      });

      for (const r of pendingSequences) {
        await tenantDb.reminder.update({
          where: { id: r.id },
          data: { status: "CANCELLED", skippedReason: "Visite technique effectuée" },
        });
        if (r.sequenceKey) {
          const suppression = buildAnchorChangedSuppression(r.sequenceKey);
          await tenantDb.reminderSuppression.create({
            data: {
              organizationId: ctx.organizationId,
              sequenceKey: suppression.sequenceKey,
              until: suppression.until,
              reason: "Visite technique effectuée",
              source: "inspection_done",
              createdById: ctx.membership.id,
            },
          });
        }
      }

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.inspection_updated",
        entity: "Vehicle",
        entityId: input.vehicleId,
        before,
        after,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),

  stats: requirePermission("reminder:stats")
    .input(reminderStatsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const where = { createdAt: { gte: input.from, lte: input.to } };
      const [sent, failed, cancelled, skipped, outcomes] = await Promise.all([
        tenantDb.reminder.count({ where: { ...where, status: "SENT" } }),
        tenantDb.reminder.count({ where: { ...where, status: "FAILED" } }),
        tenantDb.reminder.count({ where: { ...where, status: "CANCELLED" } }),
        tenantDb.reminder.count({ where: { ...where, status: "SKIPPED" } }),
        tenantDb.reminder.groupBy({
          by: ["outcome"],
          where: { ...where, outcome: { not: null } },
          _count: true,
        }),
      ]);
      return { sent, failed, cancelled, skipped, outcomes };
    }),
});
