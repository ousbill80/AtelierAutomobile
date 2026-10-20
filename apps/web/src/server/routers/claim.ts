// M16 §8 — dossiers sinistre : ouverture, pièces, expertise, devis assurance, accord (y compris
// partiel), refus, double facturation, chronologie et relances de l'assureur.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  businessDate,
  claimBlockers,
  claimFollowUpMessage,
  claimTransition,
  computeDraftTotals,
  followUpStillDue,
  formatFCFA,
  missingDocuments,
  normalizePhoneCI,
  policyExpiredAtAccident,
  type ClaimStatusLike,
} from "@atelieros/core";
import { db, type Prisma } from "@atelieros/db";
import {
  claimActivityInputSchema,
  claimFollowUpsInputSchema,
  claimIdInputSchema,
  claimListInputSchema,
  claimReasonInputSchema,
  createClaimInputSchema,
  recordApprovalInputSchema,
  recordExpertVisitInputSchema,
  scheduleExpertInputSchema,
  sendEstimateInputSchema,
  sendFollowUpInputSchema,
  snoozeFollowUpInputSchema,
  updateClaimInputSchema,
  uploadClaimDocumentInputSchema,
} from "@atelieros/validators";
import { actorOf, resolveSiteId, type OrgCtx } from "../billing/context";
import { audit, billingNow } from "../billing/service";
import {
  assertClaimsModule,
  bad,
  claimLines,
  claimQuote,
  claimRepairOrder,
  createClaimInvoices,
  guard,
  loadClaim,
  loadOrgClaimsContext,
  nextClaimNumber,
  previewClaim,
  type Tx,
} from "../claims/service";
import { setClaimStatus } from "../claims/sync";
import { emitDomainEvent } from "../events/emit";
import { messagingEnqueue } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import { loadOrgQuoteContext, recomputeQuote } from "../quotes/service";
import { getAttachmentStorage } from "../storage";
import { requirePermission, router } from "../trpc";
import { createQuoteRecord } from "./quote";

const isoDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function activity(
  tx: Tx,
  ctx: OrgCtx,
  claimId: string,
  type: string,
  body: string | null,
  data: Record<string, unknown> = {},
) {
  await tx.claimActivity.create({
    data: {
      organizationId: ctx.organizationId,
      claimId,
      type,
      body,
      data: data as Prisma.InputJsonValue,
      createdById: ctx.membership.id,
    },
  });
}

async function transition(
  tx: Tx,
  ctx: OrgCtx,
  claim: { id: string; status: string },
  action: Parameters<typeof claimTransition>[1],
  reason?: string | null,
) {
  const to = guard(() => claimTransition(claim.status as ClaimStatusLike, action));
  await setClaimStatus(tx, {
    organizationId: ctx.organizationId,
    claimId: claim.id,
    from: claim.status as ClaimStatusLike,
    to,
    membershipId: ctx.membership.id,
    now: billingNow(),
    reason,
    data: { action },
  });
  return to;
}

/** Arrêt automatique des relances (accord saisi, refus, annulation). */
async function cancelFollowUps(tx: Tx, claimId: string, kinds: string[]) {
  await tx.claimFollowUp.updateMany({
    where: {
      claimId,
      kind: { in: kinds },
      status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
    },
    data: { status: "CANCELLED" },
  });
}

function claimSearch(q: string): Prisma.InsuranceClaimWhereInput {
  const compact = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return {
    OR: [
      { number: { contains: q, mode: "insensitive" } },
      { claimNumber: { contains: q, mode: "insensitive" } },
      { customer: { displayName: { contains: q, mode: "insensitive" } } },
      ...(compact ? [{ vehicle: { plateCompact: { contains: compact } } }] : []),
    ],
  };
}

export const claimRouter = router({
  list: requirePermission("insurance:read")
    .input(claimListInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const today = businessDate(billingNow(), org.timeZone);
      const where: Prisma.InsuranceClaimWhereInput = {
        deletedAt: null,
        ...(ctx.allowedSiteIds !== "ALL" ? { siteId: { in: ctx.allowedSiteIds } } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.insurerId ? { insuranceCompanyId: input.insurerId } : {}),
        ...(input.q ? claimSearch(input.q) : {}),
      };
      const rows = await tenantDb.insuranceClaim.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          customer: { select: { id: true, displayName: true } },
          vehicle: { select: { plate: true, make: true, model: true } },
          insuranceCompany: { select: { id: true, name: true } },
          invoices: {
            where: { type: "INVOICE", status: { not: "VOID" } },
            select: { billTo: true, status: true, total: true, balance: true, dueDate: true },
          },
          repairOrders: { select: { status: true }, where: { deletedAt: null } },
        },
      });
      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const items = page.map((c) => {
        const insurerInvoice = c.invoices.find(
          (i) => i.billTo === "INSURANCE" && i.status !== "DRAFT",
        );
        const customerInvoice = c.invoices.find(
          (i) => i.billTo === "CUSTOMER" && i.status !== "DRAFT",
        );
        const blockers = claimBlockers({
          status: c.status as ClaimStatusLike,
          expertVisitAt: c.expertVisitAt,
          expertVisitedAt: c.expertVisitedAt,
          estimateSentAt: c.estimateSentAt,
          repairOrderReady: c.repairOrders.some((o) => o.status === "READY"),
          customerBalance:
            customerInvoice?.balance ??
            (c.repairOrders.some((o) => o.status === "READY") ? c.deductible : 0),
          insurerInvoiceDueDate: insurerInvoice?.dueDate ?? null,
          insurerBalance: insurerInvoice?.balance ?? 0,
          today,
        });
        return {
          id: c.id,
          number: c.number,
          claimNumber: c.claimNumber,
          status: c.status,
          customer: c.customer,
          vehicle: c.vehicle,
          insurer: c.insuranceCompany,
          deductible: c.deductible,
          approvedAmount: c.approvedAmount,
          insurerTotal: insurerInvoice?.total ?? null,
          insurerBalance: insurerInvoice?.balance ?? null,
          customerTotal: customerInvoice?.total ?? null,
          customerBalance: customerInvoice?.balance ?? null,
          blockers,
          createdAt: c.createdAt,
        };
      });
      return {
        items: input.blockedOnly ? items.filter((i) => i.blockers.length > 0) : items,
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
        timeZone: org.timeZone,
      };
    }),

  get: requirePermission("insurance:read")
    .input(claimIdInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        const today = businessDate(billingNow(), org.timeZone);
        const [
          customer,
          vehicle,
          insurer,
          order,
          quotes,
          invoices,
          attachments,
          activities,
          followUps,
        ] = await Promise.all([
          tx.customer.findFirstOrThrow({ where: { id: claim.customerId } }),
          tx.vehicle.findFirstOrThrow({ where: { id: claim.vehicleId } }),
          tx.insuranceCompany.findFirstOrThrow({ where: { id: claim.insuranceCompanyId } }),
          claimRepairOrder(tx, claim.id),
          tx.quote.findMany({
            where: { insuranceClaimId: claim.id, deletedAt: null },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              number: true,
              version: true,
              status: true,
              total: true,
              insuranceShare: true,
              customerShare: true,
              supersededAt: true,
            },
          }),
          tx.invoice.findMany({
            where: { insuranceClaimId: claim.id },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              number: true,
              type: true,
              status: true,
              billTo: true,
              total: true,
              balance: true,
              amountPaid: true,
              dueDate: true,
              issuedAt: true,
              fneStatus: true,
            },
          }),
          tx.attachment.findMany({
            where: { entity: "claim", entityId: claim.id },
            orderBy: { createdAt: "asc" },
            select: { id: true, kind: true, mimeType: true, caption: true, createdAt: true },
          }),
          tx.claimActivity.findMany({
            where: { claimId: claim.id },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
          tx.claimFollowUp.findMany({
            where: { claimId: claim.id },
            orderBy: { scheduledFor: "asc" },
          }),
        ]);
        const preview = await previewClaim(tx, org, claim, customer.displayName).catch(() => null);
        const insurerInvoice = invoices.find(
          (i) => i.billTo === "INSURANCE" && i.type === "INVOICE" && i.status !== "DRAFT",
        );
        const customerInvoice = invoices.find(
          (i) => i.billTo === "CUSTOMER" && i.type === "INVOICE" && i.status !== "DRAFT",
        );
        const duplicate = claim.accidentDate
          ? await tx.insuranceClaim.findFirst({
              where: {
                id: { not: claim.id },
                vehicleId: claim.vehicleId,
                accidentDate: claim.accidentDate,
                deletedAt: null,
                status: { not: "CANCELLED" },
              },
              select: { id: true, number: true },
            })
          : null;
        return {
          claim,
          customer: { id: customer.id, displayName: customer.displayName, phone: customer.phone },
          vehicle: {
            id: vehicle.id,
            plate: vehicle.plate,
            make: vehicle.make,
            model: vehicle.model,
            insuranceExpiryDate: vehicle.insuranceExpiryDate,
          },
          insurer: {
            id: insurer.id,
            name: insurer.name,
            claimsEmail: insurer.claimsEmail,
            claimsPhone: insurer.claimsPhone,
            requiredDocuments: insurer.requiredDocuments,
          },
          repairOrder: order ? { id: order.id, number: order.number, status: order.status } : null,
          quotes,
          invoices,
          attachments: attachments.map((a) => ({ ...a, url: `/api/attachments/${a.id}` })),
          missingDocuments: missingDocuments(
            insurer.requiredDocuments,
            attachments.map((a) => a.kind),
          ),
          activities,
          followUps,
          split: preview?.split ?? null,
          linesSource: preview?.lines.source ?? "none",
          blockers: claimBlockers({
            status: claim.status as ClaimStatusLike,
            expertVisitAt: claim.expertVisitAt,
            expertVisitedAt: claim.expertVisitedAt,
            estimateSentAt: claim.estimateSentAt,
            repairOrderReady: order?.status === "READY",
            customerBalance: customerInvoice?.balance ?? 0,
            insurerInvoiceDueDate: insurerInvoice?.dueDate ?? null,
            insurerBalance: insurerInvoice?.balance ?? 0,
            today,
          }),
          policyExpired: policyExpiredAtAccident(vehicle.insuranceExpiryDate, claim.accidentDate),
          duplicate,
          timeZone: org.timeZone,
        };
      });
    }),

  /** US-M16-01 — ouverture du dossier depuis l'OR ou la fiche véhicule. */
  create: requirePermission("insurance:manage")
    .input(createClaimInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      assertClaimsModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const order = input.repairOrderId
          ? await tx.repairOrder.findFirst({ where: { id: input.repairOrderId, deletedAt: null } })
          : null;
        if (input.repairOrderId && !order) bad("OR introuvable.");
        if (order?.insuranceClaimId) bad("Cet OR est déjà rattaché à un dossier sinistre.");
        const vehicleId = order?.vehicleId ?? input.vehicleId;
        if (!vehicleId) bad("Choisissez le véhicule sinistré.");
        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
        if (!vehicle) bad("Véhicule introuvable.");
        const customerId = order?.customerId ?? input.customerId ?? vehicle.customerId;
        if (!customerId) bad("Choisissez l'assuré.");
        const insurer = await tx.insuranceCompany.findFirst({
          where: { id: input.insuranceCompanyId, isActive: true },
        });
        if (!insurer) bad("Ajoutez d'abord une compagnie d'assurance.");
        const siteId = await resolveSiteId(tx, ctx, order?.siteId);
        const now = billingNow();
        const number = await nextClaimNumber(tx, org, siteId, now);
        const accidentDate = input.accidentDate ? isoDay(input.accidentDate) : null;
        const claim = await tx.insuranceClaim.create({
          data: {
            organizationId: ctx.organizationId,
            siteId,
            number,
            insuranceCompanyId: insurer.id,
            customerId,
            vehicleId: vehicle.id,
            policyNumber: input.policyNumber ?? vehicle.insurancePolicyNumber ?? null,
            claimNumber: input.claimNumber ?? null,
            accidentDate,
            accidentPlace: input.accidentPlace ?? null,
            circumstances: input.circumstances ?? null,
            deductible: input.deductible ?? 0,
            vatPaidBy: input.vatPaidBy ?? "INSURANCE",
            notes: input.notes ?? null,
            createdById: ctx.membership.id,
          },
        });
        if (order) {
          await tx.repairOrder.update({
            where: { id: order.id },
            data: { insuranceClaimId: claim.id },
          });
        }
        await activity(tx, ctx, claim.id, "status_change", null, { to: "OPENED" });
        await emitDomainEvent(tx as never, ctx.organizationId, "claim.created", {
          claimId: claim.id,
          number,
          repairOrderId: order?.id ?? null,
        });
        await audit(actorOf(ctx), "claim.created", "InsuranceClaim", claim.id, {
          siteId,
          after: { number, insurer: insurer.name },
        });
        return {
          claim,
          warnings: policyExpiredAtAccident(vehicle.insuranceExpiryDate, accidentDate)
            ? ["L'assurance semblait expirée à la date de l'accident."]
            : [],
        };
      });
    }),

  update: requirePermission("insurance:manage")
    .input(updateClaimInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        const invoiced = ["INVOICED", "PARTIALLY_PAID", "PAID"].includes(claim.status);
        if (
          invoiced &&
          (input.insuranceCompanyId || input.deductible !== undefined || input.vatPaidBy)
        ) {
          bad(
            "Dossier facturé : la compagnie et les montants ne se modifient plus (avoir + nouvelle facture).",
          );
        }
        if (input.insuranceCompanyId) {
          const insurer = await tx.insuranceCompany.findFirst({
            where: { id: input.insuranceCompanyId },
          });
          if (!insurer) bad("Compagnie introuvable.");
        }
        const updated = await tx.insuranceClaim.update({
          where: { id: claim.id },
          data: {
            insuranceCompanyId: input.insuranceCompanyId,
            policyNumber: input.policyNumber,
            claimNumber: input.claimNumber,
            accidentDate:
              input.accidentDate === undefined
                ? undefined
                : input.accidentDate
                  ? isoDay(input.accidentDate)
                  : null,
            accidentPlace: input.accidentPlace,
            circumstances: input.circumstances,
            deductible: input.deductible,
            vatPaidBy: input.vatPaidBy,
            notes: input.notes,
          },
        });
        await audit(actorOf(ctx), "claim.updated", "InsuranceClaim", claim.id, {
          siteId: claim.siteId,
          before: {
            insuranceCompanyId: claim.insuranceCompanyId,
            claimNumber: claim.claimNumber,
            deductible: claim.deductible,
          },
          after: {
            insuranceCompanyId: updated.insuranceCompanyId,
            claimNumber: updated.claimNumber,
            deductible: updated.deductible,
          },
          reason: input.reason ?? null,
        });
        return updated;
      });
    }),

  /** US-M16-03 — expert et date de visite. */
  scheduleExpert: requirePermission("insurance:manage")
    .input(scheduleExpertInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        let expertPhone: string | null = null;
        if (input.expertPhone?.trim()) {
          try {
            expertPhone = normalizePhoneCI(input.expertPhone).e164;
          } catch {
            bad("Numéro de l'expert invalide.");
          }
        }
        await transition(tx, ctx, claim, "schedule_expert");
        const updated = await tx.insuranceClaim.update({
          where: { id: claim.id },
          data: {
            expertName: input.expertName,
            expertFirm: input.expertFirm ?? null,
            expertPhone,
            expertEmail: input.expertEmail || null,
            expertVisitAt: input.expertVisitAt,
          },
        });
        await activity(tx, ctx, claim.id, "visit", `Expert planifié : ${input.expertName}`, {
          expertVisitAt: input.expertVisitAt.toISOString(),
        });
        return updated;
      });
    }),

  recordExpertVisit: requirePermission("insurance:manage")
    .input(recordExpertVisitInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        if (input.reportAttachmentId) {
          const att = await tx.attachment.findFirst({
            where: { id: input.reportAttachmentId, entity: "claim", entityId: claim.id },
          });
          if (!att) bad("PV d'expertise introuvable dans les pièces du dossier.");
          if (att.kind !== "expert_report") {
            await tx.attachment.update({ where: { id: att.id }, data: { kind: "expert_report" } });
          }
        }
        const updated = await tx.insuranceClaim.update({
          where: { id: claim.id },
          data: { expertVisitedAt: input.visitedAt },
        });
        await cancelFollowUps(tx, claim.id, ["expert"]);
        await activity(tx, ctx, claim.id, "visit", "Visite de l'expert effectuée", {
          visitedAt: input.visitedAt.toISOString(),
        });
        return updated;
      });
    }),

  /** US-M16-04 — devis assurance (M05) : lignes `payer = INSURANCE` par défaut. */
  createQuote: requirePermission("insurance:manage", "quote:create")
    .input(claimIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const qOrg = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        if (["INVOICED", "PARTIALLY_PAID", "PAID", "CANCELLED"].includes(claim.status)) {
          bad("Ce dossier n'accepte plus de devis.");
        }
        const order = await claimRepairOrder(tx, claim.id);
        const siteId = order?.siteId ?? (await resolveSiteId(tx, ctx, claim.siteId));
        const quote = await createQuoteRecord(
          tx,
          ctx,
          qOrg,
          {
            siteId,
            customerId: claim.customerId,
            vehicleId: claim.vehicleId,
            repairOrderId: order?.id ?? null,
            origin: "INSURANCE",
            insuranceClaimId: claim.id,
            notes: `Devis assurance — sinistre ${claim.number}`,
          },
          billingNow(),
        );
        // Prérempli avec les travaux déjà saisis sur l'OR (lignes non annulées), à la charge de
        // l'assureur ; les lignes de l'OR restent la source de la facturation (pas de lien).
        if (order) {
          const roLines = await tx.repairOrderLine.findMany({
            where: { repairOrderId: order.id, status: { not: "CANCELLED" } },
            orderBy: { sortOrder: "asc" },
          });
          for (const [i, l] of roLines.entries()) {
            await tx.quoteLine.create({
              data: {
                organizationId: ctx.organizationId,
                quoteId: quote.id,
                type: l.type,
                productId: l.productId,
                laborOperationId: l.laborOperationId,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discountRate: l.discountRate,
                vatRate: l.vatRate,
                payer: l.payer === "CUSTOMER" ? "CUSTOMER" : "INSURANCE",
                isCustomerSupplied: l.isCustomerSupplied,
                sortOrder: i,
              },
            });
          }
          if (roLines.length > 0) await recomputeQuote(tx, quote.id, qOrg.vatEnabled);
        }
        await tx.insuranceClaim.update({ where: { id: claim.id }, data: { quoteId: quote.id } });
        await activity(tx, ctx, claim.id, "note", `Devis assurance ${quote.number} créé`, {
          quoteId: quote.id,
        });
        return { quoteId: quote.id, number: quote.number };
      });
    }),

  /** US-M16-04 — devis envoyé à l'assureur / remis à l'expert : démarre le délai « accord ». */
  sendEstimate: requirePermission("insurance:manage")
    .input(sendEstimateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        const quote = input.quoteId
          ? await tx.quote.findFirst({ where: { id: input.quoteId, insuranceClaimId: claim.id } })
          : await claimQuote(tx, claim);
        if (!quote) bad("Créez d'abord le devis assurance du dossier.");
        const lines = await tx.quoteLine.count({ where: { quoteId: quote.id } });
        if (lines === 0) bad("Le devis assurance est vide.");
        const insurer = await tx.insuranceCompany.findFirstOrThrow({
          where: { id: claim.insuranceCompanyId },
        });
        const kinds = (
          await tx.attachment.findMany({
            where: { entity: "claim", entityId: claim.id },
            select: { kind: true },
          })
        ).map((a) => a.kind);
        const missing = missingDocuments(insurer.requiredDocuments, kinds);
        const wasRepairing = ["APPROVED", "REPAIRING"].includes(claim.status);
        await transition(
          tx,
          ctx,
          claim,
          "send_estimate",
          wasRepairing ? "Devis complémentaire" : null,
        );
        const updated = await tx.insuranceClaim.update({
          where: { id: claim.id },
          data: { estimateSentAt: billingNow(), quoteId: quote.id },
        });
        await activity(
          tx,
          ctx,
          claim.id,
          input.channel === "whatsapp" ? "whatsapp" : input.channel === "email" ? "email" : "note",
          `Devis ${quote.number} v${quote.version} transmis${input.address ? ` à ${input.address}` : ""}`,
          { quoteId: quote.id, channel: input.channel },
        );
        return { claim: updated, missingDocuments: missing };
      });
    }),

  /** US-M16-05 — accord de l'assureur, même partiel (RG-M16-05). */
  recordApproval: requirePermission("claim:approve_record")
    .input(recordApprovalInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        const lines = await claimLines(tx, claim);
        const E = computeDraftTotals(lines.insurance, { vatEnabled: org.vatEnabled }).totals.total;
        const gap = Math.max(0, E - input.approvedAmount);
        let gapHandling = input.gapHandling ?? null;
        if (gap > 0 && !gapHandling) {
          bad(
            `Accord inférieur au devis de ${formatFCFA(gap)} : choisissez de réviser le devis, de mettre l'écart à la charge du client ou de l'absorber.`,
          );
        }
        if (gap === 0) gapHandling = null;
        if (gapHandling === "GARAGE") {
          if (!ctx.permissions.has("claim:absorb_gap")) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Permission manquante : claim:absorb_gap",
            });
          }
          if (!input.reason?.trim()) bad("Indiquez le motif de la remise garage.");
        }
        if (input.approvalAttachmentId) {
          const att = await tx.attachment.findFirst({
            where: { id: input.approvalAttachmentId, entity: "claim", entityId: claim.id },
          });
          if (!att) bad("Lettre d'accord introuvable dans les pièces du dossier.");
          if (att.kind !== "approval_letter") {
            await tx.attachment.update({
              where: { id: att.id },
              data: { kind: "approval_letter" },
            });
          }
        }
        await transition(tx, ctx, claim, "approve", input.reason ?? null);
        const updated = await tx.insuranceClaim.update({
          where: { id: claim.id },
          data: {
            approvedAmount: input.approvedAmount,
            deductible: input.deductible,
            depreciationAmount: input.depreciation ?? 0,
            approvalRef: input.approvalRef ?? null,
            approvedAt: billingNow(),
            gapHandling,
            gapAmount: gapHandling === "CUSTOMER" ? gap : 0,
          },
        });
        await cancelFollowUps(tx, claim.id, ["approval", "expert"]);
        const order = await claimRepairOrder(tx, claim.id);
        const startedBefore =
          order &&
          ["IN_PROGRESS", "WAITING_PARTS", "QUALITY_CHECK", "READY"].includes(order.status);
        await activity(
          tx,
          ctx,
          claim.id,
          "note",
          `Accord ${formatFCFA(input.approvedAmount)} — franchise ${formatFCFA(input.deductible)}${
            input.depreciation ? `, vétusté ${formatFCFA(input.depreciation)}` : ""
          }${gap > 0 ? ` — écart ${formatFCFA(gap)} (${gapHandling})` : ""}${
            startedBefore ? " — travaux démarrés avant accord" : ""
          }`,
          {
            approvedAmount: input.approvedAmount,
            gap,
            gapHandling,
            approvalRef: input.approvalRef ?? null,
          },
        );
        await emitDomainEvent(tx as never, ctx.organizationId, "claim.approved", {
          claimId: claim.id,
          approvedAmount: input.approvedAmount,
        });
        await audit(actorOf(ctx), "claim.approval_recorded", "InsuranceClaim", claim.id, {
          siteId: claim.siteId,
          after: {
            approvedAmount: input.approvedAmount,
            deductible: input.deductible,
            gap,
            gapHandling,
          },
          reason: input.reason ?? null,
        });
        const customer = await tx.customer.findFirstOrThrow({ where: { id: claim.customerId } });
        const preview = await previewClaim(tx, org, updated, customer.displayName);
        return {
          claim: updated,
          split: preview.split,
          warnings: startedBefore ? ["Travaux démarrés avant accord."] : [],
        };
      });
    }),

  /** US-M16-10 — refus de prise en charge. */
  reject: requirePermission("claim:approve_record")
    .input(claimReasonInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        await transition(tx, ctx, claim, "reject", input.reason);
        await cancelFollowUps(tx, claim.id, ["approval", "expert"]);
        await audit(actorOf(ctx), "claim.rejected", "InsuranceClaim", claim.id, {
          siteId: claim.siteId,
          reason: input.reason,
        });
        return tx.insuranceClaim.update({
          where: { id: claim.id },
          data: { rejectedAt: billingNow(), rejectReason: input.reason },
        });
      });
    }),

  cancel: requirePermission("insurance:manage")
    .input(claimReasonInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        await transition(tx, ctx, claim, "cancel", input.reason);
        await cancelFollowUps(tx, claim.id, ["approval", "expert", "payment"]);
        await audit(actorOf(ctx), "claim.cancelled", "InsuranceClaim", claim.id, {
          siteId: claim.siteId,
          reason: input.reason,
        });
        return tx.insuranceClaim.update({
          where: { id: claim.id },
          data: { closedAt: billingNow() },
        });
      });
    }),

  previewSplit: requirePermission("insurance:read")
    .input(claimIdInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        const customer = await tx.customer.findFirstOrThrow({ where: { id: claim.customerId } });
        const preview = await previewClaim(tx, org, claim, customer.displayName);
        return {
          ...preview.split,
          source: preview.lines.source,
          insurerTotals: preview.invoices?.insurer.totals ?? null,
          customerTotals: preview.invoices?.customer.totals ?? null,
        };
      });
    }),

  /** US-M16-06 — « Facturer le sinistre » : deux brouillons M08 (assurance + client). */
  invoice: requirePermission("claim:invoice", "invoice:create")
    .input(claimIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      assertClaimsModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(
        async (tx) => {
          const claim = await loadClaim(tx, ctx, input.id);
          const res = await createClaimInvoices(tx, org, claim, ctx.membership.id);
          await activity(tx, ctx, claim.id, "note", "Factures assurance et client préparées", {
            insurerInvoiceId: res.insurerInvoice.id,
            customerInvoiceId: res.customerInvoice?.id ?? null,
          });
          await audit(actorOf(ctx), "claim.invoiced", "InsuranceClaim", claim.id, {
            siteId: claim.siteId,
            after: {
              insurerTotal: res.insurerInvoice.total,
              customerTotal: res.customerInvoice?.total ?? 0,
            },
          });
          return res;
        },
        { timeout: 20_000, maxWait: 20_000 },
      );
    }),

  addActivity: requirePermission("insurance:read")
    .input(claimActivityInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.permissions.has("insurance:manage") && !ctx.permissions.has("claim:followup")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Permission manquante : insurance:manage",
        });
      }
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const claim = await loadClaim(tx, ctx, input.id);
        return tx.claimActivity.create({
          data: {
            organizationId: ctx.organizationId,
            claimId: claim.id,
            type: input.type,
            body: input.body,
            nextActionAt: input.nextActionAt ?? null,
            createdById: ctx.membership.id,
          },
        });
      });
    }),

  uploadDocument: requirePermission("insurance:manage")
    .input(uploadClaimDocumentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const claim = await tenantDb.transaction((tx) => loadClaim(tx, ctx, input.id));
      const body = Buffer.from(input.dataBase64, "base64");
      const ext = input.mimeType === "application/pdf" ? "pdf" : input.mimeType.split("/")[1];
      const key = `${ctx.organizationId}/claims/${claim.id}/${input.kind}-${randomUUID()}.${ext}`;
      try {
        await getAttachmentStorage().upload({
          key,
          body,
          contentType: input.mimeType,
          maxBytes: 10_000_000,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          String((error as { code: unknown }).code).startsWith("storage.")
        ) {
          bad(error.message);
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Envoi du fichier impossible. Réessayez.",
        });
      }
      return tenantDb.transaction(async (tx) => {
        const attachment = await tx.attachment.create({
          data: {
            organizationId: ctx.organizationId,
            entity: "claim",
            entityId: claim.id,
            kind: input.kind,
            url: key,
            mimeType: input.mimeType,
            size: body.byteLength,
            caption: input.caption ?? null,
            createdById: ctx.membership.id,
          },
        });
        await activity(tx, ctx, claim.id, "note", `Pièce ajoutée : ${input.kind}`, {
          attachmentId: attachment.id,
        });
        return { attachmentId: attachment.id, url: `/api/attachments/${attachment.id}` };
      });
    }),

  /** /assurances/relances — relances dues, à valider. */
  followUps: requirePermission("claim:followup")
    .input(claimFollowUpsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = input.dueBefore ?? new Date(billingNow().getTime() + 86_400_000);
      return tenantDb.claimFollowUp.findMany({
        where: {
          status: { in: ["NEEDS_APPROVAL", "PLANNED", "SNOOZED"] },
          scheduledFor: { lte: before },
          claim: ctx.allowedSiteIds !== "ALL" ? { siteId: { in: ctx.allowedSiteIds } } : {},
        },
        orderBy: { scheduledFor: "asc" },
        take: 200,
        include: {
          claim: {
            select: {
              id: true,
              number: true,
              claimNumber: true,
              insuranceCompany: { select: { name: true, claimsEmail: true, claimsPhone: true } },
              customer: { select: { displayName: true } },
            },
          },
        },
      });
    }),

  /** Validation et envoi immédiat d'une relance (M11) ; condition revérifiée avant l'envoi. */
  sendFollowUp: requirePermission("claim:followup")
    .input(sendFollowUpInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgClaimsContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await tenantDb.transaction(async (tx) => {
        const followUp = await tx.claimFollowUp.findFirst({ where: { id: input.followUpId } });
        if (!followUp) throw new TRPCError({ code: "NOT_FOUND", message: "Relance introuvable." });
        if (!["NEEDS_APPROVAL", "PLANNED", "SNOOZED"].includes(followUp.status)) {
          bad("Cette relance est déjà traitée.");
        }
        const claim = await loadClaim(tx, ctx, followUp.claimId);
        const invoice = followUp.invoiceId
          ? await tx.invoice.findFirst({ where: { id: followUp.invoiceId } })
          : null;
        if (
          !followUpStillDue({
            kind: followUp.kind,
            claimStatus: claim.status,
            expertVisitedAt: claim.expertVisitedAt,
            invoiceBalance: invoice?.balance ?? null,
          })
        ) {
          await tx.claimFollowUp.update({
            where: { id: followUp.id },
            data: { status: "SKIPPED" },
          });
          return { skipped: true as const, messageId: null };
        }
        const [insurer, customer, vehicle] = await Promise.all([
          tx.insuranceCompany.findFirstOrThrow({ where: { id: claim.insuranceCompanyId } }),
          tx.customer.findFirstOrThrow({ where: { id: claim.customerId } }),
          tx.vehicle.findFirst({ where: { id: claim.vehicleId }, select: { plate: true } }),
        ]);
        const email =
          followUp.kind === "payment"
            ? insurer.accountingEmail || insurer.claimsEmail
            : insurer.claimsEmail;
        const phone = insurer.claimsPhone;
        if (!email && !phone) {
          bad(
            "Aucun contact numérique pour cette compagnie : appelez-la puis notez l'appel dans la chronologie.",
          );
        }
        const text = claimFollowUpMessage({
          kind: followUp.kind,
          garageName: org.legalName || org.name,
          claimNumber: claim.number,
          insurerClaimNumber: claim.claimNumber,
          plate: vehicle?.plate ?? null,
          insuredName: customer.displayName,
          invoiceNumber: invoice?.number ?? null,
          balance: invoice ? formatFCFA(invoice.balance) : null,
          daysLate: invoice?.dueDate
            ? Math.max(
                0,
                Math.floor((billingNow().getTime() - invoice.dueDate.getTime()) / 86_400_000),
              )
            : null,
        });
        const channels = input.channel
          ? [input.channel]
          : ([email ? "EMAIL" : null, phone ? "WHATSAPP" : null, phone ? "SMS" : null].filter(
              Boolean,
            ) as ("EMAIL" | "WHATSAPP" | "SMS")[]);
        const enqueued = await messagingEnqueue(tx, ctx.organizationId, {
          idempotencyKey: `claim:${followUp.dedupeKey}`,
          kind: "system",
          to: { email, phone, whatsapp: phone, name: insurer.claimsContactName ?? insurer.name },
          channels,
          bodyOverride: text.body,
          subjectOverride: text.subject,
          sentById: ctx.membership.id,
        });
        if ("reason" in enqueued) bad("Aucun canal disponible pour joindre la compagnie.");
        await tx.claimFollowUp.update({
          where: { id: followUp.id },
          data: {
            status: "QUEUED",
            channel: enqueued.message.channel,
            messageId: enqueued.message.id,
            sentAt: billingNow(),
          },
        });
        await activity(tx, ctx, claim.id, "followup", text.subject, {
          followUpId: followUp.id,
          kind: followUp.kind,
          step: followUp.stepKey,
        });
        await tx.claimActivity.updateMany({
          where: {
            claimId: claim.id,
            type: "followup",
            messageId: null,
            data: { path: ["followUpId"], equals: followUp.id },
          },
          data: { messageId: enqueued.message.id },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "claim.followup_sent", {
          claimId: claim.id,
          followUpId: followUp.id,
          messageId: enqueued.message.id,
        });
        return { skipped: false as const, messageId: enqueued.message.id };
      });
      if (result.messageId) await enqueueMessageSendJob(result.messageId);
      return result;
    }),

  snoozeFollowUp: requirePermission("claim:followup")
    .input(snoozeFollowUpInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const followUp = await tx.claimFollowUp.findFirst({ where: { id: input.followUpId } });
        if (!followUp) throw new TRPCError({ code: "NOT_FOUND", message: "Relance introuvable." });
        await loadClaim(tx, ctx, followUp.claimId);
        return tx.claimFollowUp.update({
          where: { id: followUp.id },
          data: { status: "SNOOZED", snoozedUntil: input.until, scheduledFor: input.until },
        });
      });
    }),
});
