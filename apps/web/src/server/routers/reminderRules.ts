import { TRPCError } from "@trpc/server";
import {
  isDomainError,
  isEligible,
  groupReminders,
  recipientKey,
  resolveReminderChannels,
  targetDate,
  validateStopOn,
  validateSteps,
  type ReminderChannel,
  type ReminderStep,
  type ReminderType,
} from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  getReminderRuleInputSchema,
  simulateReminderRuleInputSchema,
  toggleReminderRuleInputSchema,
  upsertReminderRuleInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

/**
 * Convertit une `DomainError` de validation de règle (RG-M10-03/06/23) en erreur tRPC lisible
 * côté UI (message FR déjà porté par l'erreur métier).
 */
function runValidation(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (isDomainError(err)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    }
    throw err;
  }
}

export const reminderRulesRouter = router({
  list: requirePermission("reminder:rules_manage").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.reminderRule.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  }),

  get: requirePermission("reminder:rules_manage")
    .input(getReminderRuleInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.reminderRule.findFirstOrThrow({ where: { id: input.id } });
    }),

  /** RG-M10-03/06/23 — crée ou met à jour une règle (frise de paliers éditable, US-M10-07). */
  upsert: requirePermission("reminder:rules_manage")
    .input(upsertReminderRuleInputSchema)
    .mutation(async ({ ctx, input }) => {
      runValidation(() => validateSteps(input.steps as ReminderStep[]));
      runValidation(() => validateStopOn(input.stopOn));

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const data = {
        type: input.type,
        name: input.name,
        isActive: input.isActive,
        steps: input.steps,
        sendWindow: input.sendWindow,
        conditions: input.conditions,
        stopOn: input.stopOn,
      };

      if (input.id) {
        const before = await tenantDb.reminderRule.findFirstOrThrow({ where: { id: input.id } });
        const after = await tenantDb.reminderRule.update({ where: { id: input.id }, data });
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "reminder_rule.updated",
          entity: "ReminderRule",
          entityId: after.id,
          before: { name: before.name, isActive: before.isActive, steps: before.steps },
          after: { name: after.name, isActive: after.isActive, steps: after.steps },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return after;
      }

      const created = await tenantDb.reminderRule.create({
        data: { ...data, organizationId: ctx.organizationId },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "reminder_rule.created",
        entity: "ReminderRule",
        entityId: created.id,
        before: null,
        after: { name: created.name, type: created.type, steps: created.steps },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return created;
    }),

  toggle: requirePermission("reminder:rules_manage")
    .input(toggleReminderRuleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.reminderRule.findFirstOrThrow({ where: { id: input.id } });
      const after = await tenantDb.reminderRule.update({
        where: { id: input.id },
        data: { isActive: input.isActive },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: input.isActive ? "reminder_rule.activated" : "reminder_rule.deactivated",
        entity: "ReminderRule",
        entityId: after.id,
        before: { isActive: before.isActive },
        after: { isActive: after.isActive },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return after;
    }),

  /**
   * RG-M10-01 à 09/12/15 — aperçu d'impact d'une règle (brouillon ou existante) sur les `days`
   * prochains jours, calculé à blanc (aucune écriture). Couvre les types adossés à une date
   * d'échéance déjà modélisée sur `Vehicle`/`Invoice`/`Appointment` (INSPECTION, SERVICE,
   * INSURANCE_EXPIRY, RECEIVABLE, APPOINTMENT) ; QUOTE_FOLLOWUP/VEHICLE_READY/SATISFACTION
   * nécessitent des entités hors périmètre de cette tranche (devis/OR terminés) et renvoient un
   * aperçu vide plutôt qu'une estimation fausse — écart documenté au PRD §7.2.
   */
  simulate: requirePermission("reminder:rules_manage")
    .input(simulateReminderRuleInputSchema)
    .query(async ({ ctx, input }) => {
      const { rule, days } = input;
      runValidation(() => validateSteps(rule.steps as ReminderStep[]));
      runValidation(() => validateStopOn(rule.stopOn));

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const windowEnd = new Date(now.getTime() + days * 86_400_000);
      const steps = rule.steps as ReminderStep[];
      const maxOffsetMs =
        Math.max(1, ...steps.map((s) => Math.abs(s.offsetDays))) * 86_400_000 + 86_400_000;
      const anchorFrom = new Date(now.getTime() - maxOffsetMs);
      const anchorTo = new Date(windowEnd.getTime() + maxOffsetMs);

      interface Anchor {
        id: string;
        dueDate: Date;
        vehicleId: string | null;
        customerType: "INDIVIDUAL" | "COMPANY";
        tags: readonly string[];
        amount?: number | null;
        deletedAt: Date | null;
        doNotRemind: boolean;
        remindersConsent: boolean;
        optedOutAt: Date | null;
        preferredChannel: ReminderChannel | null;
        hasWhatsapp: boolean | null;
        phoneE164: string | null;
        email: string | null;
      }

      function fromCustomer(customer: {
        type: "INDIVIDUAL" | "COMPANY";
        tags: string[];
        deletedAt: Date | null;
        doNotRemind: boolean;
        remindersConsent: boolean;
        optedOutAt: Date | null;
        preferredChannel: string | null;
        hasWhatsapp: boolean | null;
        whatsappPhone: string | null;
        phone: string | null;
        phone2: string | null;
        email: string | null;
        phoneInvalidAt: Date | null;
      }) {
        return {
          customerType: customer.type,
          tags: customer.tags,
          deletedAt: customer.deletedAt,
          doNotRemind: customer.doNotRemind,
          remindersConsent: customer.remindersConsent,
          optedOutAt: customer.optedOutAt,
          preferredChannel: customer.preferredChannel as ReminderChannel | null,
          hasWhatsapp: customer.hasWhatsapp,
          phoneE164: customer.phoneInvalidAt
            ? null
            : (customer.whatsappPhone ?? customer.phone ?? customer.phone2 ?? null),
          email: customer.email,
        };
      }

      let anchors: Anchor[] = [];
      switch (rule.type) {
        case "INSPECTION": {
          const vehicles = await tenantDb.vehicle.findMany({
            where: { inspectionExpiryDate: { gte: anchorFrom, lte: anchorTo } },
            include: { customer: true },
          });
          anchors = vehicles
            .filter((v) => v.inspectionExpiryDate)
            .map((v) => ({
              id: v.id,
              dueDate: v.inspectionExpiryDate as Date,
              vehicleId: v.id,
              ...fromCustomer(v.customer),
            }));
          break;
        }
        case "SERVICE": {
          const vehicles = await tenantDb.vehicle.findMany({
            where: { nextServiceDueDate: { gte: anchorFrom, lte: anchorTo } },
            include: { customer: true },
          });
          anchors = vehicles
            .filter((v) => v.nextServiceDueDate)
            .map((v) => ({
              id: v.id,
              dueDate: v.nextServiceDueDate as Date,
              vehicleId: v.id,
              ...fromCustomer(v.customer),
            }));
          break;
        }
        case "INSURANCE_EXPIRY": {
          const vehicles = await tenantDb.vehicle.findMany({
            where: { insuranceExpiryDate: { gte: anchorFrom, lte: anchorTo } },
            include: { customer: true },
          });
          anchors = vehicles
            .filter((v) => v.insuranceExpiryDate)
            .map((v) => ({
              id: v.id,
              dueDate: v.insuranceExpiryDate as Date,
              vehicleId: v.id,
              ...fromCustomer(v.customer),
            }));
          break;
        }
        case "RECEIVABLE": {
          const invoices = await tenantDb.invoice.findMany({
            where: { dueDate: { gte: anchorFrom, lte: anchorTo }, balance: { gt: 0 } },
            include: { customer: true },
          });
          anchors = invoices.map((inv) => ({
            id: inv.id,
            dueDate: inv.dueDate as Date,
            vehicleId: null,
            amount: inv.balance,
            ...fromCustomer(inv.customer),
          }));
          break;
        }
        case "APPOINTMENT": {
          const appointments = await tenantDb.appointment.findMany({
            where: {
              startsAt: { gte: anchorFrom, lte: anchorTo },
              status: { in: ["BOOKED", "CONFIRMED"] },
            },
            include: { customer: true },
          });
          anchors = appointments.map((a) => ({
            id: a.id,
            dueDate: a.startsAt,
            vehicleId: a.vehicleId,
            ...fromCustomer(a.customer),
          }));
          break;
        }
        default:
          anchors = [];
      }

      let total = 0;
      let noChannel = 0;
      const byStep: Record<string, number> = {};
      const groupables: Array<{
        id: string;
        recipientKey: string;
        type: ReminderType;
        stepKey: string;
        scheduledDateKey: string;
        vehicleId?: string | null;
      }> = [];
      const sample: Array<{ vehicleId: string | null; stepKey: string; scheduledFor: string }> = [];

      for (const anchor of anchors) {
        const eligible = isEligible(
          rule.type,
          {
            customerType: anchor.customerType,
            deletedAt: anchor.deletedAt,
            doNotRemind: anchor.doNotRemind,
            remindersConsent: anchor.remindersConsent,
            isOptedOut: anchor.optedOutAt != null,
            tags: anchor.tags,
            amount: anchor.amount,
          },
          rule.conditions,
        );
        if (!eligible) continue;

        for (const step of steps) {
          const target = targetDate({ default: anchor.dueDate }, step);
          if (target.getTime() < now.getTime() || target.getTime() > windowEnd.getTime()) continue;

          total += 1;
          byStep[step.key] = (byStep[step.key] ?? 0) + 1;

          const channels = resolveReminderChannels({
            preferredChannel: anchor.preferredChannel,
            stepChannels: step.channels,
            hasWhatsapp: anchor.hasWhatsapp,
            phoneE164: anchor.phoneE164,
            email: anchor.email,
          });
          if (channels.length === 0) noChannel += 1;

          const rk =
            recipientKey({ phoneE164: anchor.phoneE164, email: anchor.email }) ?? anchor.id;
          groupables.push({
            id: `${anchor.id}:${step.key}`,
            recipientKey: rk,
            type: rule.type,
            stepKey: step.key,
            // Approximation jour civil UTC pour le regroupement d'aperçu (pas d'envoi réel ici).
            scheduledDateKey: target.toISOString().slice(0, 10),
            vehicleId: anchor.vehicleId,
          });
          if (sample.length < 10) {
            sample.push({
              vehicleId: anchor.vehicleId,
              stepKey: step.key,
              scheduledFor: target.toISOString(),
            });
          }
        }
      }

      const groups = groupReminders(groupables);

      return { total, byStep, grouped: groups.length, noChannel, sample };
    }),
});
