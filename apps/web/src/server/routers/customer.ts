import { TRPCError } from "@trpc/server";
import {
  computeDisplayName,
  computeReachability,
  mergePlan,
  normalizePhoneCI,
  normalizePlate,
  type CustomerType,
  type MergeFieldInput,
  type MergeSide,
} from "@atelieros/core";
import { adminDb, db, Prisma } from "@atelieros/db";
import {
  addNoteInputSchema,
  checkDuplicatesInputSchema,
  customerAnonymizeInputSchema,
  customerCreateInputSchema,
  customerDeleteInputSchema,
  customerExportDataInputSchema,
  customerGetInputSchema,
  customerListInputSchema,
  customerMergeInputSchema,
  customerTimelineInputSchema,
  customerUpdateInputSchema,
  duplicatesDismissInputSchema,
  duplicatesListInputSchema,
  mergePreviewInputSchema,
  reactivateRemindersInputSchema,
  setConsentInputSchema,
  setCreditInputSchema,
  type CustomerInput,
  type CustomerListInput,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";
import { toTRPCError } from "../domain-error";
import { findDuplicateCandidates, type DuplicateCandidate } from "../customer-duplicates";
import {
  applyCatalogDefaults,
  assertPlateAvailable,
  OPEN_REPAIR_ORDER_STATUSES,
  withStatuses,
} from "./vehicle";

/** Champs résolus champ par champ par `mergePlan` (RG-M02-08). Tags et consentement sont traités à part. */
const MERGEABLE_FIELDS = [
  "type",
  "firstName",
  "lastName",
  "companyName",
  "civility",
  "phone",
  "phone2",
  "whatsappPhone",
  "email",
  "address",
  "commune",
  "ncc",
  "rccm",
  "preferredChannel",
  "paymentTermsDays",
  "creditLimit",
  "priceListId",
  "discountRate",
  "notes",
  "source",
] as const;

const OPEN_COLLECTION_STATUSES = ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"] as const;
const PENDING_REMINDER_STATUSES = ["PLANNED", "NEEDS_APPROVAL"] as const;

function addDaysUTC(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function pickEarliestNonNull(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/** Une FIXED ivoirienne ne reçoit ni WhatsApp ni SMS (RG-M02-03) ; MOBILE/FOREIGN comptent comme joignables. */
function isMobileOrForeign(e164: string | null): boolean {
  if (!e164) return false;
  try {
    const parsed = normalizePhoneCI(e164);
    return parsed.type === "MOBILE" || parsed.type === "FOREIGN";
  } catch {
    return false;
  }
}

/** Normalise un téléphone saisi : renvoie l'E.164 si résolu, sinon la saisie brute (RG-M02-03, statut NEEDS_REVIEW). */
function normalizePhoneForStorage(raw: string): string {
  let result: ReturnType<typeof normalizePhoneCI>;
  try {
    result = normalizePhoneCI(raw);
  } catch (error) {
    return toTRPCError(error);
  }
  return result.e164 ?? raw.trim();
}

function computeDisplayNameOrThrow(input: {
  type: CustomerType;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  try {
    return computeDisplayName(input);
  } catch (error) {
    return toTRPCError(error);
  }
}

/** Numéros E.164 distincts d'un `CustomerInput`, pour la détection de doublons (RG-M02-07). */
function collectPhoneE164s(input: {
  phone?: string | null;
  phone2?: string | null;
  whatsappPhone?: string | null;
}): string[] {
  const values = [input.phone, input.phone2, input.whatsappPhone]
    .filter((v): v is string => Boolean(v))
    .map((v) => normalizePhoneForStorage(v));
  return Array.from(new Set(values));
}

async function findCustomerOrThrow(tenantDb: ReturnType<typeof db.forTenant>, id: string) {
  return tenantDb.customer.findFirstOrThrow({ where: { id, deletedAt: null } });
}

/** Construit la clause `where` Prisma de `customer.list` à partir des filtres (RG partagée avec `segment.preview`). */
export function buildCustomerWhere(
  filters: Pick<
    CustomerListInput,
    | "type"
    | "tags"
    | "commune"
    | "optedOut"
    | "hasBalance"
    | "inspectionWithinDays"
    | "serviceDue"
    | "q"
  >,
  now: Date,
): Record<string, unknown> {
  const where: Record<string, unknown> = { deletedAt: null, mergedIntoId: null };
  if (filters.type) where.type = filters.type;
  if (filters.tags && filters.tags.length > 0) where.tags = { hasSome: filters.tags };
  if (filters.commune) where.commune = filters.commune;
  if (filters.optedOut !== undefined) {
    where.optedOutAt = filters.optedOut ? { not: null } : null;
  }
  if (filters.hasBalance) {
    where.invoices = { some: { balance: { gt: 0 }, status: { not: "VOID" } } };
  }
  const vehicleConditions: Record<string, unknown>[] = [];
  if (filters.inspectionWithinDays !== undefined) {
    vehicleConditions.push({
      inspectionExpiryDate: { gte: now, lte: addDaysUTC(now, filters.inspectionWithinDays) },
    });
  }
  if (filters.serviceDue) {
    vehicleConditions.push({ nextServiceDueDate: { lte: now } });
  }
  if (vehicleConditions.length > 0) {
    where.vehicles = { some: { deletedAt: null, AND: vehicleConditions } };
  }
  if (filters.q) {
    const digits = filters.q.replace(/\D/g, "");
    where.OR = [
      { displayName: { contains: filters.q, mode: "insensitive" } },
      { email: { contains: filters.q, mode: "insensitive" } },
      { ncc: { contains: filters.q, mode: "insensitive" } },
      ...(digits.length >= 2
        ? [{ phone: { contains: digits } }, { phone2: { contains: digits } }]
        : []),
    ];
  }
  return where;
}

export const customerRouter = router({
  list: requirePermission("customer:read")
    .input(customerListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();

      let filters: typeof input = input;
      if (input.segmentId) {
        const segment = await tenantDb.customerSegment.findFirstOrThrow({
          where: { id: input.segmentId },
        });
        filters = { ...(segment.filters as Partial<typeof input>), ...input } as typeof input;
      }

      const where = buildCustomerWhere(filters, now);

      const orderBy =
        filters.sort === "name_asc"
          ? { displayName: "asc" as const }
          : filters.sort === "name_desc"
            ? { displayName: "desc" as const }
            : filters.sort === "newest"
              ? { createdAt: "desc" as const }
              : filters.sort === "oldest"
                ? { createdAt: "asc" as const }
                : { lastVisitAt: "desc" as const };

      const rows = await tenantDb.customer.findMany({
        where,
        orderBy,
        take: filters.limit + 1,
        ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > filters.limit;
      const items = hasMore ? rows.slice(0, filters.limit) : rows;
      return { items, nextCursor: hasMore ? rows[filters.limit]!.id : null };
    }),

  get: requirePermission("customer:read")
    .input(customerGetInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const customer = await tenantDb.customer.findFirstOrThrow({
        where: { id: input.id, deletedAt: null },
        include: {
          contacts: { where: { deletedAt: null } },
          vehicles: { where: { deletedAt: null } },
        },
      });

      const [dueAgg, overdueAgg] = await Promise.all([
        tenantDb.invoice.aggregate({
          _sum: { balance: true },
          where: { customerId: input.id, balance: { gt: 0 }, status: { not: "VOID" } },
        }),
        tenantDb.invoice.aggregate({
          _sum: { balance: true },
          where: {
            customerId: input.id,
            balance: { gt: 0 },
            status: { not: "VOID" },
            dueDate: { lt: now },
          },
        }),
      ]);

      const reachability = computeReachability({
        hasMobilePhone:
          isMobileOrForeign(customer.phone) || isMobileOrForeign(customer.whatsappPhone),
        hasEmail: Boolean(customer.email),
        doNotRemind: customer.doNotRemind,
        optedOutAt: customer.optedOutAt,
      });

      return {
        ...customer,
        vehicles: customer.vehicles.map((v) => withStatuses(v, now)),
        balance: {
          due: dueAgg._sum.balance ?? 0,
          overdue: overdueAgg._sum.balance ?? 0,
          creditLimit: customer.creditLimit,
        },
        reachability,
      };
    }),

  create: requirePermission("customer:create")
    .input(customerCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const displayName = computeDisplayNameOrThrow(input.customer);
      const phoneE164s = collectPhoneE164s(input.customer);

      const candidates = (
        await findDuplicateCandidates({
          organizationId: ctx.organizationId,
          name: displayName,
          phoneE164s,
          email: input.customer.email ?? null,
          ncc: input.customer.ncc ?? null,
          commune: input.customer.commune ?? null,
        })
      ).filter((c) => c.level !== "NONE");

      const blocking = candidates.find((c) => c.level === "BLOCKING");
      if (blocking && !input.duplicateOverrideReason) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ce client existe peut-être déjà : ${blocking.displayName} (${blocking.reasons.join(", ")}).`,
          cause: { code: "DUPLICATE_SUSPECTED", candidates },
        });
      }

      let vehicleCreateData: Record<string, unknown> | null = null;
      if (input.vehicle) {
        const withDefaults = await applyCatalogDefaults(input.vehicle);
        let normalized: ReturnType<typeof normalizePlate>;
        try {
          normalized = normalizePlate(withDefaults.plate);
        } catch (error) {
          toTRPCError(error);
        }
        await assertPlateAvailable(tenantDb, normalized.plateCompact, normalized.plateType);
        vehicleCreateData = {
          organizationId: ctx.organizationId,
          plate: normalized.plate,
          plateCompact: normalized.plateCompact,
          plateType: normalized.plateType,
          usage: withDefaults.usage,
          vin: withDefaults.vin ?? null,
          make: withDefaults.make,
          model: withDefaults.model,
          makeId: withDefaults.makeId ?? null,
          modelId: withDefaults.modelId ?? null,
          year: withDefaults.year ?? null,
          fuel: withDefaults.fuel ?? null,
          transmission: withDefaults.transmission ?? null,
          color: withDefaults.color ?? null,
          odometerInMiles: withDefaults.odometerInMiles,
          currentMileage: withDefaults.currentMileage ?? null,
          currentMileageAt: withDefaults.currentMileage != null ? new Date() : null,
          serviceIntervalKm: withDefaults.serviceIntervalKm ?? null,
          serviceIntervalMonths: withDefaults.serviceIntervalMonths ?? null,
        };
      }

      const customer = await tenantDb.customer.create({
        data: {
          organizationId: ctx.organizationId,
          type: input.customer.type,
          firstName: input.customer.firstName ?? null,
          lastName: input.customer.lastName ?? null,
          companyName: input.customer.companyName ?? null,
          displayName,
          civility: input.customer.civility ?? null,
          phone: input.customer.phone ? normalizePhoneForStorage(input.customer.phone) : null,
          phone2: input.customer.phone2 ? normalizePhoneForStorage(input.customer.phone2) : null,
          whatsappPhone: input.customer.whatsappPhone
            ? normalizePhoneForStorage(input.customer.whatsappPhone)
            : null,
          email: input.customer.email ?? null,
          address: input.customer.address ?? null,
          commune: input.customer.commune ?? null,
          ncc: input.customer.ncc ?? null,
          rccm: input.customer.rccm ?? null,
          preferredChannel: input.customer.preferredChannel ?? null,
          marketingConsent: input.customer.marketingConsent ?? false,
          tags: input.customer.tags ?? [],
          notes: input.customer.notes ?? null,
          source: input.customer.source ?? null,
        },
      });

      let vehicle: Awaited<ReturnType<typeof tenantDb.vehicle.create>> | null = null;
      if (vehicleCreateData) {
        vehicle = await tenantDb.vehicle.create({
          data: {
            ...vehicleCreateData,
            customerId: customer.id,
          } as Prisma.VehicleUncheckedCreateInput,
        });
      }

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.created",
        entity: "Customer",
        entityId: customer.id,
        after: customer,
        reason: input.duplicateOverrideReason ?? undefined,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      if (vehicle) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "vehicle.created",
          entity: "Vehicle",
          entityId: vehicle.id,
          after: vehicle,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }

      return {
        customer,
        vehicle,
        duplicates: candidates.length > 0 ? candidates : undefined,
      };
    }),

  update: requirePermission("customer:update")
    .input(customerUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findCustomerOrThrow(tenantDb, input.id);
      const patch = input.patch;

      let displayName: string | undefined;
      if (
        patch.type !== undefined ||
        patch.firstName !== undefined ||
        patch.lastName !== undefined ||
        patch.companyName !== undefined
      ) {
        displayName = computeDisplayNameOrThrow({
          type: (patch.type ?? before.type) as CustomerType,
          firstName: patch.firstName !== undefined ? patch.firstName : before.firstName,
          lastName: patch.lastName !== undefined ? patch.lastName : before.lastName,
          companyName: patch.companyName !== undefined ? patch.companyName : before.companyName,
        });
      }

      const { phone, phone2, whatsappPhone, ...rest } = patch;
      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: {
          ...rest,
          ...(displayName !== undefined ? { displayName } : {}),
          ...(phone !== undefined ? { phone: phone ? normalizePhoneForStorage(phone) : null } : {}),
          ...(phone2 !== undefined
            ? { phone2: phone2 ? normalizePhoneForStorage(phone2) : null }
            : {}),
          ...(whatsappPhone !== undefined
            ? { whatsappPhone: whatsappPhone ? normalizePhoneForStorage(whatsappPhone) : null }
            : {}),
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.updated",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return customer;
    }),

  checkDuplicates: requirePermission("customer:read")
    .input(checkDuplicatesInputSchema)
    .query(async ({ ctx, input }) => {
      const phoneE164s = input.phone ? [normalizePhoneForStorage(input.phone)] : [];
      const candidates = await findDuplicateCandidates({
        organizationId: ctx.organizationId,
        name: input.name ?? "",
        phoneE164s,
        email: input.email ?? null,
        ncc: input.ncc ?? null,
        excludeId: input.excludeId,
      });
      return candidates.filter((c) => c.level !== "NONE");
    }),

  // RG-M02-07 : pas de job nocturne `customers.detect_duplicates` dans cette étape (déviation documentée) —
  // balayage borné à la demande sur les 200 clients les plus récemment modifiés.
  duplicatesList: requirePermission("customer:merge")
    .input(duplicatesListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customers = await tenantDb.customer.findMany({
        where: { deletedAt: null, mergedIntoId: null },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
          id: true,
          displayName: true,
          phone: true,
          phone2: true,
          whatsappPhone: true,
          email: true,
          ncc: true,
          commune: true,
        },
      });

      const dismissals = await tenantDb.duplicateDismissal.findMany({
        where: { entity: "customer" },
      });
      const dismissedSet = new Set(dismissals.map((d) => `${d.idA}:${d.idB}`));

      interface Pair {
        customerIdA: string;
        customerIdB: string;
        displayNameA: string;
        displayNameB: string;
        score: number;
        reasons: string[];
        level: DuplicateCandidate["level"];
      }
      const pairs: Pair[] = [];
      const seen = new Set<string>();

      for (const customer of customers) {
        const phoneE164s = [customer.phone, customer.phone2, customer.whatsappPhone].filter(
          (v): v is string => Boolean(v),
        );
        const candidates = await findDuplicateCandidates({
          organizationId: ctx.organizationId,
          name: customer.displayName,
          phoneE164s,
          email: customer.email,
          ncc: customer.ncc,
          commune: customer.commune,
          excludeId: customer.id,
        });
        for (const candidate of candidates) {
          if (candidate.level === "NONE") continue;
          const [idA, idB] = [customer.id, candidate.customerId].sort();
          const pairKey = `${idA}:${idB}`;
          if (seen.has(pairKey) || dismissedSet.has(pairKey)) continue;
          seen.add(pairKey);
          pairs.push({
            customerIdA: idA,
            customerIdB: idB,
            displayNameA: idA === customer.id ? customer.displayName : candidate.displayName,
            displayNameB: idB === customer.id ? customer.displayName : candidate.displayName,
            score: candidate.score,
            reasons: candidate.reasons,
            level: candidate.level,
          });
        }
      }

      pairs.sort((a, b) => b.score - a.score);
      const offset = input.cursor ? Number(input.cursor) : 0;
      const page = pairs.slice(offset, offset + input.limit);
      const nextCursor = offset + input.limit < pairs.length ? String(offset + input.limit) : null;
      return { items: page, nextCursor };
    }),

  duplicatesDismiss: requirePermission("customer:merge")
    .input(duplicatesDismissInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [idA, idB] = [input.customerIdA, input.customerIdB].sort();
      return adminDb.duplicateDismissal.upsert({
        where: {
          organizationId_entity_idA_idB: {
            organizationId: ctx.organizationId,
            entity: "customer",
            idA,
            idB,
          },
        },
        create: {
          organizationId: ctx.organizationId,
          entity: "customer",
          idA,
          idB,
          dismissedById: ctx.membership.id,
        },
        update: {},
      });
    }),

  mergePreview: requirePermission("customer:merge")
    .input(mergePreviewInputSchema)
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      const [source, target] = await Promise.all([
        adminDb.customer.findFirstOrThrow({
          where: { id: input.sourceId, organizationId, deletedAt: null },
        }),
        adminDb.customer.findFirstOrThrow({
          where: { id: input.targetId, organizationId, deletedAt: null },
        }),
      ]);

      const fields = MERGEABLE_FIELDS.filter((key) => {
        const sourceValue = (source as Record<string, unknown>)[key];
        const targetValue = (target as Record<string, unknown>)[key];
        return JSON.stringify(sourceValue) !== JSON.stringify(targetValue);
      }).map((key) => ({
        field: key,
        sourceValue: (source as Record<string, unknown>)[key],
        targetValue: (target as Record<string, unknown>)[key],
      }));

      const [
        vehicles,
        contacts,
        appointments,
        repairOrders,
        quotes,
        invoices,
        payments,
        reminders,
        insuranceClaims,
        notes,
      ] = await Promise.all([
        adminDb.vehicle.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.customerContact.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.appointment.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.repairOrder.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.quote.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.invoice.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.payment.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.reminder.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.insuranceClaim.count({ where: { organizationId, customerId: input.sourceId } }),
        adminDb.customerNote.count({ where: { organizationId, customerId: input.sourceId } }),
      ]);

      return {
        fields,
        documentsToMove: {
          vehicles,
          contacts,
          appointments,
          repairOrders,
          quotes,
          invoices,
          payments,
          reminders,
          insuranceClaims,
          notes,
        },
      };
    }),

  // RG-M02-08 — fusion transactionnelle d'un client dans un autre (US-M02-08).
  merge: requirePermission("customer:merge")
    .input(customerMergeInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.sourceId === input.targetId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Impossible de fusionner un client avec lui-même.",
        });
      }
      const organizationId = ctx.organizationId;

      const [source, target] = await Promise.all([
        adminDb.customer.findFirstOrThrow({
          where: { id: input.sourceId, organizationId, deletedAt: null },
        }),
        adminDb.customer.findFirstOrThrow({
          where: { id: input.targetId, organizationId, deletedAt: null },
        }),
      ]);

      if (input.confirmName.trim().toLowerCase() !== source.displayName.trim().toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Le nom saisi ne correspond pas à « ${source.displayName} ».`,
        });
      }

      const [sourceReminders, targetReminders] = await Promise.all([
        adminDb.reminder.findMany({
          where: {
            organizationId,
            customerId: input.sourceId,
            status: { in: [...PENDING_REMINDER_STATUSES] },
          },
          select: { id: true, dedupeKey: true },
        }),
        adminDb.reminder.findMany({
          where: {
            organizationId,
            customerId: input.targetId,
            status: { in: [...PENDING_REMINDER_STATUSES] },
          },
          select: { dedupeKey: true },
        }),
      ]);

      const fieldsInput: Record<string, MergeFieldInput> = {};
      for (const key of MERGEABLE_FIELDS) {
        fieldsInput[key] = {
          sourceValue: (source as Record<string, unknown>)[key],
          targetValue: (target as Record<string, unknown>)[key],
        };
      }

      const plan = mergePlan({
        fields: fieldsInput,
        choices: input.fieldChoices as Record<string, MergeSide>,
        sourceUpdatedAt: source.updatedAt,
        targetUpdatedAt: target.updatedAt,
        sourceTags: source.tags,
        targetTags: target.tags,
        sourceConsent: {
          remindersConsent: source.remindersConsent,
          marketingConsent: source.marketingConsent,
          doNotRemind: source.doNotRemind,
          optedOutAt: source.optedOutAt,
        },
        targetConsent: {
          remindersConsent: target.remindersConsent,
          marketingConsent: target.marketingConsent,
          doNotRemind: target.doNotRemind,
          optedOutAt: target.optedOutAt,
        },
        // Déviation documentée : pas d'algorithme M10 de recalcul de `dedupeKey` disponible à cette étape ;
        // on compare les clés brutes (collision déjà peu probable grâce à l'unicité en base avant fusion).
        sourceReminderDedupeKeys: sourceReminders.map((r) => r.dedupeKey),
        targetReminderDedupeKeys: targetReminders.map((r) => r.dedupeKey),
      });

      const nextDisplayName = computeDisplayNameOrThrow({
        type: plan.fields.type as CustomerType,
        firstName: plan.fields.firstName as string | null,
        lastName: plan.fields.lastName as string | null,
        companyName: plan.fields.companyName as string | null,
      });

      const moved = await adminDb.$transaction(async (tx) => {
        const counts: Record<string, number> = {};

        const reassign = async (
          model: {
            updateMany: (args: {
              where: Record<string, unknown>;
              data: Record<string, unknown>;
            }) => Promise<{ count: number }>;
          },
          key: string,
        ) => {
          const result = await model.updateMany({
            where: { customerId: input.sourceId, organizationId },
            data: { customerId: input.targetId },
          });
          counts[key] = result.count;
        };

        await reassign(tx.vehicle, "vehicles");
        await reassign(tx.customerContact, "contacts");
        await reassign(tx.appointment, "appointments");
        await reassign(tx.repairOrder, "repairOrders");
        await reassign(tx.quote, "quotes");
        await reassign(tx.invoice, "invoices");
        await reassign(tx.payment, "payments");
        await reassign(tx.insuranceClaim, "insuranceClaims");
        await reassign(tx.customerNote, "notes");

        // CollectionCase : fusion des dossiers ouverts (RG-M02-08), sinon simple réaffectation.
        const [sourceCase, targetCase] = await Promise.all([
          tx.collectionCase.findFirst({
            where: {
              organizationId,
              customerId: input.sourceId,
              status: { in: [...OPEN_COLLECTION_STATUSES] },
            },
          }),
          tx.collectionCase.findFirst({
            where: {
              organizationId,
              customerId: input.targetId,
              status: { in: [...OPEN_COLLECTION_STATUSES] },
            },
          }),
        ]);
        if (sourceCase && targetCase) {
          await tx.paymentPromise.updateMany({
            where: { collectionCaseId: sourceCase.id },
            data: { collectionCaseId: targetCase.id },
          });
          await tx.collectionNote.updateMany({
            where: { collectionCaseId: sourceCase.id },
            data: { collectionCaseId: targetCase.id },
          });
          await tx.collectionCase.update({
            where: { id: targetCase.id },
            data: {
              totalDue: targetCase.totalDue + sourceCase.totalDue,
              stage: Math.max(targetCase.stage, sourceCase.stage),
              oldestDueDate: pickEarliestNonNull(
                targetCase.oldestDueDate,
                sourceCase.oldestDueDate,
              ),
            },
          });
          await tx.collectionCase.update({
            where: { id: sourceCase.id },
            data: { closedAt: new Date(), closeReason: "fusion" },
          });
          counts.collectionCases = 1;
        } else {
          const result = await tx.collectionCase.updateMany({
            where: { organizationId, customerId: input.sourceId },
            data: { customerId: input.targetId },
          });
          counts.collectionCases = result.count;
        }

        // Relances en attente : annule les collisions de dedupeKey, réaffecte le reste ; l'historique suit.
        const cancelledSet = new Set(plan.cancelledSourceReminderDedupeKeys);
        const toCancel = sourceReminders
          .filter((r) => cancelledSet.has(r.dedupeKey))
          .map((r) => r.id);
        const toReassign = sourceReminders
          .filter((r) => !cancelledSet.has(r.dedupeKey))
          .map((r) => r.id);
        if (toCancel.length > 0) {
          await tx.reminder.updateMany({
            where: { id: { in: toCancel } },
            data: { status: "CANCELLED", skippedReason: "Doublon fusionné" },
          });
        }
        if (toReassign.length > 0) {
          await tx.reminder.updateMany({
            where: { id: { in: toReassign } },
            data: { customerId: input.targetId },
          });
        }
        const otherReminders = await tx.reminder.updateMany({
          where: { organizationId, customerId: input.sourceId },
          data: { customerId: input.targetId },
        });
        counts.reminders = toReassign.length + otherReminders.count;

        // Conversation : conflit d'unicité (organizationId, channel, externalAddress) possible.
        const sourceConversations = await tx.conversation.findMany({
          where: { organizationId, customerId: input.sourceId },
        });
        let conversationsMoved = 0;
        for (const conv of sourceConversations) {
          const conflict = await tx.conversation.findFirst({
            where: {
              organizationId,
              channel: conv.channel,
              externalAddress: conv.externalAddress,
              customerId: input.targetId,
            },
          });
          if (conflict) {
            await tx.message.updateMany({
              where: { conversationId: conv.id },
              data: { conversationId: conflict.id },
            });
            await tx.conversation.delete({ where: { id: conv.id } });
          } else {
            await tx.conversation.update({
              where: { id: conv.id },
              data: { customerId: input.targetId },
            });
            conversationsMoved++;
          }
        }
        counts.conversations = conversationsMoved;

        await reassign(tx.message, "messages");

        const externalRefs = await tx.externalRef.updateMany({
          where: { organizationId, entity: "customer", internalId: input.sourceId },
          data: { internalId: input.targetId },
        });
        counts.externalRefs = externalRefs.count;

        await tx.customer.update({
          where: { id: input.targetId },
          data: {
            ...plan.fields,
            displayName: nextDisplayName,
            tags: plan.tags,
            remindersConsent: plan.consent.remindersConsent,
            marketingConsent: plan.consent.marketingConsent,
            doNotRemind: plan.consent.doNotRemind,
            optedOutAt: plan.consent.optedOutAt,
          },
        });

        await tx.customer.update({
          where: { id: input.sourceId },
          data: { deletedAt: new Date(), mergedIntoId: input.targetId },
        });

        return counts;
      });

      await writeAuditLog({
        organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.merge",
        entity: "Customer",
        entityId: input.targetId,
        before: source,
        after: { targetId: input.targetId, moved },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { targetId: input.targetId, moved };
    }),

  setConsent: requirePermission("customer:consent")
    .input(setConsentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findCustomerOrThrow(tenantDb, input.id);

      const data: Record<string, unknown> = {
        consentUpdatedAt: new Date(),
        consentSource: input.source,
      };
      if (input.remindersConsent !== undefined) data.remindersConsent = input.remindersConsent;
      if (input.marketingConsent !== undefined) data.marketingConsent = input.marketingConsent;
      if (input.doNotRemind !== undefined) {
        data.doNotRemind = input.doNotRemind;
        data.doNotRemindReason = input.doNotRemind ? (input.reason ?? null) : null;
      }

      const customer = await tenantDb.customer.update({ where: { id: input.id }, data });

      if (input.doNotRemind === true) {
        await tenantDb.reminder.updateMany({
          where: { customerId: input.id, status: { in: [...PENDING_REMINDER_STATUSES] } },
          data: { status: "CANCELLED", skippedReason: input.reason ?? "Ne plus relancer" },
        });
      }

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.consent_changed",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        reason: input.reason ?? undefined,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return customer;
    }),

  reactivateReminders: requirePermission("customer:consent")
    .input(reactivateRemindersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findCustomerOrThrow(tenantDb, input.id);

      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: {
          optedOutAt: null,
          doNotRemind: false,
          doNotRemindReason: null,
          consentUpdatedAt: new Date(),
          consentSource: input.source,
        },
      });

      const addresses = [
        customer.phone,
        customer.phone2,
        customer.whatsappPhone,
        customer.email,
      ].filter((v): v is string => Boolean(v));
      if (addresses.length > 0) {
        await adminDb.optOut.deleteMany({
          where: { organizationId: ctx.organizationId, address: { in: addresses } },
        });
      }

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.consent_changed",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        reason: input.proof ?? undefined,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return customer;
    }),

  setCredit: requirePermission("customer:credit")
    .input(setCreditInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findCustomerOrThrow(tenantDb, input.id);

      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: { paymentTermsDays: input.paymentTermsDays, creditLimit: input.creditLimit ?? null },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.credit_updated",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return customer;
    }),

  // US-M02-10 — chronologie 360°. Déviation documentée : fusion en mémoire de plusieurs tables
  // (pas de table d'événements unifiée), `nextCursor` toujours `null` (pas de pagination stable au-delà
  // de la première page).
  timeline: requirePermission("customer:read")
    .input(customerTimelineInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await findCustomerOrThrow(tenantDb, input.id);

      const wantType = (t: string) =>
        !input.types || input.types.includes(t as (typeof input.types)[number]);
      const vehicleFilter = input.vehicleId ? { vehicleId: input.vehicleId } : {};
      const items: Array<{ type: string; occurredAt: Date; id: string; data: unknown }> = [];

      if (wantType("appointment")) {
        const rows = await tenantDb.appointment.findMany({
          where: { customerId: input.id, ...vehicleFilter },
          orderBy: { startsAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({ type: "appointment", occurredAt: r.startsAt, id: r.id, data: r })),
        );
      }
      if (wantType("repair_order")) {
        const rows = await tenantDb.repairOrder.findMany({
          where: { customerId: input.id, ...vehicleFilter },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({
            type: "repair_order",
            occurredAt: r.createdAt,
            id: r.id,
            data: r,
          })),
        );
      }
      if (wantType("quote")) {
        const rows = await tenantDb.quote.findMany({
          where: { customerId: input.id, ...vehicleFilter },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({ type: "quote", occurredAt: r.createdAt, id: r.id, data: r })),
        );
      }
      if (wantType("invoice")) {
        const rows = await tenantDb.invoice.findMany({
          where: { customerId: input.id, ...vehicleFilter },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({ type: "invoice", occurredAt: r.createdAt, id: r.id, data: r })),
        );
      }
      if (wantType("payment")) {
        const rows = await tenantDb.payment.findMany({
          where: { customerId: input.id },
          orderBy: { receivedAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({ type: "payment", occurredAt: r.receivedAt, id: r.id, data: r })),
        );
      }
      if (wantType("note")) {
        const rows = await tenantDb.customerNote.findMany({
          where: { customerId: input.id, deletedAt: null, ...vehicleFilter },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({ type: "note", occurredAt: r.createdAt, id: r.id, data: r })),
        );
      }
      if (wantType("message")) {
        const rows = await tenantDb.message.findMany({
          where: { customerId: input.id },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({ type: "message", occurredAt: r.createdAt, id: r.id, data: r })),
        );
      }
      if (input.vehicleId && wantType("mileage_reading")) {
        const rows = await tenantDb.mileageReading.findMany({
          where: { vehicleId: input.vehicleId },
          orderBy: { readAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({
            type: "mileage_reading",
            occurredAt: r.readAt,
            id: r.id,
            data: r,
          })),
        );
      }
      if (input.vehicleId && wantType("vehicle_event")) {
        const rows = await tenantDb.vehicleEvent.findMany({
          where: { vehicleId: input.vehicleId },
          orderBy: { occurredAt: "desc" },
          take: input.limit,
        });
        items.push(
          ...rows.map((r) => ({
            type: "vehicle_event",
            occurredAt: r.occurredAt,
            id: r.id,
            data: r,
          })),
        );
      }

      items.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      return { items: items.slice(0, input.limit), nextCursor: null };
    }),

  addNote: requirePermission("customer:update")
    .input(addNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await findCustomerOrThrow(tenantDb, input.customerId);

      const note = await tenantDb.customerNote.create({
        data: {
          organizationId: ctx.organizationId,
          customerId: input.customerId,
          vehicleId: input.vehicleId ?? null,
          body: input.body,
          pinned: input.pinned,
          createdById: ctx.membership.id,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.note_added",
        entity: "CustomerNote",
        entityId: note.id,
        after: note,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return note;
    }),

  delete: requirePermission("customer:delete")
    .input(customerDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findCustomerOrThrow(tenantDb, input.id);

      const openOrder = await tenantDb.repairOrder.findFirst({
        where: { customerId: input.id, status: { in: [...OPEN_REPAIR_ORDER_STATUSES] } },
      });
      if (openOrder) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Un OR est en cours (${openOrder.number}). Impossible de supprimer ce client.`,
        });
      }
      const pendingQuote = await tenantDb.quote.findFirst({
        where: { customerId: input.id, status: { in: ["SENT", "VIEWED"] } },
      });
      if (pendingQuote) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Un devis (${pendingQuote.number}) est en attente de réponse pour ce client.`,
        });
      }
      const unpaid = await tenantDb.invoice.aggregate({
        _sum: { balance: true },
        where: { customerId: input.id, balance: { gt: 0 }, status: { not: "VOID" } },
      });
      const totalDue = unpaid._sum.balance ?? 0;
      if (totalDue > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ce client a ${totalDue.toLocaleString("fr-FR")} FCFA d'impayés.`,
        });
      }

      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
      await tenantDb.reminder.updateMany({
        where: { customerId: input.id, status: { in: [...PENDING_REMINDER_STATUSES] } },
        data: { status: "CANCELLED", skippedReason: "Client supprimé" },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.deleted",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true };
    }),

  // US-M02-13 — déviation documentée : pas de file de jobs (`ExportJob`) à cette étape (seul `ImportJob`
  // existe, pour M13) ; l'export renvoie directement les données au lieu d'un `{ jobId }` asynchrone.
  exportData: requirePermission("customer:export")
    .input(customerExportDataInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirstOrThrow({
        where: { id: input.id, deletedAt: null },
        include: {
          vehicles: true,
          contacts: true,
          invoices: true,
          appointments: true,
          quotes: true,
          payments: true,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.data_exported",
        entity: "Customer",
        entityId: customer.id,
        after: { exportedAt: new Date() },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { data: customer };
    }),

  anonymize: requirePermission("customer:delete", "customer:export")
    .input(customerAnonymizeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findCustomerOrThrow(tenantDb, input.id);

      const invoiceCount = await tenantDb.invoice.count({
        where: { customerId: input.id, status: { not: "VOID" } },
      });
      const anonymizedName = `Client anonymisé #${input.id.slice(-4).toUpperCase()}`;

      const customer = await tenantDb.customer.update({
        where: { id: input.id },
        data: {
          firstName: null,
          lastName: null,
          companyName: null,
          displayName: anonymizedName,
          phone: null,
          phone2: null,
          whatsappPhone: null,
          email: null,
          address: null,
          ncc: null,
          rccm: null,
          notes: null,
          anonymizedAt: new Date(),
          // Facture émises conservées (obligation légale) : suppression logique seulement sans facture.
          ...(invoiceCount === 0 ? { deletedAt: new Date() } : {}),
        },
      });

      await tenantDb.conversation.deleteMany({ where: { customerId: input.id } });
      await tenantDb.vehicle.updateMany({
        where: { customerId: input.id },
        data: { driverName: null, driverPhone: null },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.anonymized",
        entity: "Customer",
        entityId: customer.id,
        before,
        after: customer,
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true };
    }),
});

export type { CustomerInput };
