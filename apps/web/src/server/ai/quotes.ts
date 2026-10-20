// M17 — lot « devis » : pré-devis depuis doléances + inspection (US-M17-03, RG-M17-13) et
// explication client du devis (US-M17-04, RG-M17-19). L'IA ne choisit que dans la liste
// candidate présélectionnée par le code ; prix, TVA et remises sont calculés par M05
// (`buildQuoteLineData`, core/money) ; rien n'est créé ni affiché au client avant validation.
import {
  buildQuoteDraftLines,
  computeLine,
  fallbackQuoteDraftLines,
  groupQuoteLines,
  laborLinePricing,
  redactPii,
  selectQuoteCandidates,
  type DraftNeed,
  type QuoteDraftLine,
} from "@atelieros/core";
import { db, type Prisma } from "@atelieros/db";
import {
  buildQuoteDraftMessages,
  buildQuoteExplanationMessages,
  QUOTE_DRAFT_PROMPT_VERSION,
  QUOTE_DRAFT_SYSTEM,
  QUOTE_EXPLANATION_PROMPT_VERSION,
  QUOTE_EXPLANATION_SYSTEM,
  quoteDraftConsoleOutput,
  quoteDraftOutputSchema,
  quoteExplanationConsoleOutput,
  quoteExplanationOutputSchema,
  type QuoteDraftPromptInput,
  type QuoteExplanationPromptInput,
} from "@atelieros/integrations";
import type { QuoteLineInput } from "@atelieros/validators";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { assertQuoteModule, bad, loadOrgQuoteContext, quoteNotFound } from "../quotes/service";
import { roNow } from "../repairOrders/helpers";
import { requirePermission, requireSite } from "../trpc";
import { businessCaller, registerAcceptHandler } from "./accept";
import { getAiService } from "./service";
import { createSuggestion } from "./suggestions";

type TenantDb = ReturnType<typeof db.forTenant>;

const CLOSED_RO = ["DELIVERED", "INVOICED", "CANCELLED"];

/** Ligne proposée enrichie d'un prix indicatif HT (calculé par le code, jamais par l'IA). */
export interface QuoteDraftSuggestionLine extends QuoteDraftLine {
  unitPrice: number;
  estimatedSubtotal: number;
}

export interface QuoteDraftSuggestionPayload {
  repairOrderId: string;
  inspectionId: string | null;
  lines: QuoteDraftSuggestionLine[];
  unmatched: string[];
  rejected: number;
  compatibilityChecked: boolean;
  fallbackReason: string | null;
}

export interface QuoteExplanationSuggestionPayload {
  quoteId: string;
  groups: { key: string; label: string; text: string }[];
  fallbackReason: string | null;
}

/** Contexte du pré-devis, chargé uniquement via `db.forTenant` (RG-M17-03). */
async function loadDraftContext(tx: TenantDb, repairOrderId: string) {
  const order = await tx.repairOrder.findFirst({ where: { id: repairOrderId, deletedAt: null } });
  if (!order) bad("Ordre de réparation introuvable.");
  const [vehicle, customer, inspection, products, labor] = await Promise.all([
    order.vehicleId ? tx.vehicle.findFirst({ where: { id: order.vehicleId } }) : null,
    tx.customer.findFirstOrThrow({ where: { id: order.customerId } }),
    tx.inspection.findFirst({
      where: { repairOrderId: order.id },
      orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }),
    tx.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        category: true,
        sku: true,
        oemReference: true,
        compatibleWith: true,
        salePrice: true,
        vatRate: true,
      },
      take: 5_000,
    }),
    tx.laborOperation.findMany({ where: { isActive: true } }),
  ]);
  return { order, vehicle, customer, inspection, products, labor };
}

function needsOf(
  inspection: Awaited<ReturnType<typeof loadDraftContext>>["inspection"],
  complaint: string | null,
): DraftNeed[] {
  const needs: DraftNeed[] = (inspection?.items ?? [])
    .filter((i) => i.result === "URGENT" || i.result === "WATCH")
    .map((i) => ({
      key: `insp:${i.id}`,
      label: i.label,
      priority: i.result as "URGENT" | "WATCH",
      measurement: i.measurement,
      comment: i.comment,
      category: i.category,
      inspectionItemId: i.id,
      recommendedProductIds: i.recommendedProductIds,
      recommendedLaborIds: i.recommendedLaborIds,
    }));
  if (complaint?.trim()) needs.push({ key: "complaint", label: complaint.trim(), priority: null });
  return needs;
}

const draftQuote = requirePermission("ai:use", "quote:create")
  .input(z.object({ repairOrderId: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const org = await loadOrgQuoteContext(ctx.organizationId);
    assertQuoteModule(org);
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const now = roNow();
    const data = await loadDraftContext(tx, input.repairOrderId);
    requireSite(ctx, data.order.siteId);
    if (CLOSED_RO.includes(data.order.status)) bad("L'OR est clôturé.");

    // RG-M17-04 : téléphones/emails masqués dans les textes libres envoyés au modèle.
    const complaint = data.order.complaint ? redactPii(data.order.complaint).text : null;
    const diagnosis = data.order.diagnosis ? redactPii(data.order.diagnosis).text : null;
    const needs = needsOf(data.inspection, complaint).map((n) => ({
      ...n,
      comment: n.comment ? redactPii(n.comment).text : n.comment,
    }));
    if (needs.length === 0) {
      bad("Aucune doléance ni point d'inspection à chiffrer sur cet OR.");
    }
    const vehicle = {
      make: data.vehicle?.make ?? null,
      model: data.vehicle?.model ?? null,
      year: data.vehicle?.year ?? null,
    };
    const { candidates, compatibilityChecked } = selectQuoteCandidates({
      needs,
      complaint,
      diagnosis,
      vehicle,
      products: data.products,
      labor: data.labor,
    });
    const promptInput: QuoteDraftPromptInput = {
      vehicle: { ...vehicle, mileage: data.order.mileageIn ?? null },
      complaint,
      diagnosis,
      needs,
      candidates,
      compatibilityChecked,
    };
    const result = await getAiService().runStructured({
      feature: "quote_draft",
      promptVersion: QUOTE_DRAFT_PROMPT_VERSION,
      ctx: { organizationId: ctx.organizationId, membershipId: ctx.membership.id },
      inputRef: `repair_order:${data.order.id}`,
      system: QUOTE_DRAFT_SYSTEM,
      messages: buildQuoteDraftMessages(promptInput),
      schema: quoteDraftOutputSchema,
      maxTokens: 4_000,
      consoleOutput: () => quoteDraftConsoleOutput(promptInput),
    });
    const draft = result.ok
      ? buildQuoteDraftLines({ aiLines: result.output.lines, candidates, needs })
      : fallbackQuoteDraftLines({ needs, products: data.products, labor: data.labor });

    const products = new Map(data.products.map((p) => [p.id, p]));
    const ops = new Map(data.labor.map((o) => [o.id, o]));
    const discountRate = data.customer.discountRate ?? 0;
    const lines: QuoteDraftSuggestionLine[] = draft.lines.map((line) => {
      let unitPrice = 0;
      let vatRate = org.vatEnabled ? org.vatRate : 0;
      if (line.kind === "LABOR" && line.catalogId) {
        unitPrice = laborLinePricing(ops.get(line.catalogId)!, org.laborRates).unitPrice;
      } else if (line.catalogId) {
        const product = products.get(line.catalogId)!;
        unitPrice = product.salePrice;
        vatRate = org.vatEnabled ? product.vatRate : 0;
      }
      const totals = computeLine({
        quantity: line.quantity,
        unitPrice,
        discountRate: line.catalogId ? discountRate : 0,
        vatRate,
        vatEnabled: org.vatEnabled,
      });
      return { ...line, unitPrice, estimatedSubtotal: totals.lineSubtotal };
    });
    const payload: QuoteDraftSuggestionPayload = {
      repairOrderId: data.order.id,
      inspectionId: data.inspection?.id ?? null,
      lines,
      unmatched: draft.unmatched,
      rejected: draft.rejected,
      compatibilityChecked,
      fallbackReason: result.ok ? null : result.reason,
    };
    const suggestion = await createSuggestion(tx, {
      organizationId: ctx.organizationId,
      interactionId: result.interactionId,
      feature: "quote_draft",
      targetEntity: "repair_order",
      targetId: data.order.id,
      payload,
      isFallback: !result.ok,
      now,
    });
    return { suggestionId: suggestion.id, isFallback: !result.ok, ...payload };
  });

async function loadQuoteForExplanation(tx: TenantDb, quoteId: string) {
  const quote = await tx.quote.findFirst({ where: { id: quoteId, deletedAt: null } });
  if (!quote) quoteNotFound();
  const [lines, vehicle] = await Promise.all([
    tx.quoteLine.findMany({ where: { quoteId: quote.id }, orderBy: { sortOrder: "asc" } }),
    quote.vehicleId ? tx.vehicle.findFirst({ where: { id: quote.vehicleId } }) : null,
  ]);
  const itemIds = lines.map((l) => l.inspectionItemId).filter((v): v is string => !!v);
  const items = itemIds.length
    ? await tx.inspectionItem.findMany({ where: { id: { in: itemIds } } })
    : [];
  return { quote, lines, vehicle, items };
}

const explainQuote = requirePermission("ai:use", "quote:create")
  .input(z.object({ quoteId: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const org = await loadOrgQuoteContext(ctx.organizationId);
    assertQuoteModule(org);
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const now = roNow();
    const data = await loadQuoteForExplanation(tx, input.quoteId);
    requireSite(ctx, data.quote.siteId);
    if (data.lines.length === 0) bad("Ajoutez des lignes au devis avant de générer l'explication.");
    const itemById = new Map(data.items.map((i) => [i.id, i]));
    const groups = groupQuoteLines(data.lines).map((g) => {
      const item = g.lines
        .map((l) => (l.inspectionItemId ? itemById.get(l.inspectionItemId) : undefined))
        .find((i) => i !== undefined);
      return {
        key: g.key,
        label: g.label,
        priority: g.priority === "URGENT" || g.priority === "WATCH" ? g.priority : null,
        lines: g.lines.map((l) => l.description),
        measurement: item ? item.measurement : null,
        comment: item?.comment ? redactPii(item.comment).text : null,
      };
    });
    const promptInput: QuoteExplanationPromptInput = {
      vehicle: data.vehicle ? `${data.vehicle.make} ${data.vehicle.model}` : null,
      groups,
    };
    const result = await getAiService().runStructured({
      feature: "quote_explanation",
      promptVersion: QUOTE_EXPLANATION_PROMPT_VERSION,
      ctx: { organizationId: ctx.organizationId, membershipId: ctx.membership.id },
      inputRef: `quote:${data.quote.id}`,
      system: QUOTE_EXPLANATION_SYSTEM,
      messages: buildQuoteExplanationMessages(promptInput),
      schema: quoteExplanationOutputSchema,
      consoleOutput: () => quoteExplanationConsoleOutput(promptInput),
    });
    // Repli sans IA : explication existante (catalogue MO / inspection), à compléter à la main.
    const texts = new Map(result.ok ? result.output.groups.map((g) => [g.key, g.text]) : []);
    const existing = (data.quote.customerExplanation ?? {}) as Record<string, string>;
    const lineExplanation = new Map(
      groupQuoteLines(data.lines).map((g) => [g.key, g.explanation ?? ""]),
    );
    const payload: QuoteExplanationSuggestionPayload = {
      quoteId: data.quote.id,
      groups: groups.map((g) => ({
        key: g.key,
        label: g.label,
        text: texts.get(g.key) ?? existing[g.key] ?? lineExplanation.get(g.key) ?? "",
      })),
      fallbackReason: result.ok ? null : result.reason,
    };
    const suggestion = await createSuggestion(tx, {
      organizationId: ctx.organizationId,
      interactionId: result.interactionId,
      feature: "quote_explanation",
      targetEntity: "quote",
      targetId: data.quote.id,
      payload,
      isFallback: !result.ok,
      now,
    });
    return { suggestionId: suggestion.id, isFallback: !result.ok, ...payload };
  });

export const quotesProcedures = { draftQuote, explainQuote };

// ── Acceptation (RG-M17-02 : procédure métier normale, permissions et audit) ──

const draftEditSchema = z.object({ selectedKeys: z.array(z.string()).max(200) }).optional();

registerAcceptHandler("quote_draft", {
  permissions: ["quote:create"],
  async run({ ctx, suggestion, editedPayload }) {
    const payload = suggestion.payload as unknown as QuoteDraftSuggestionPayload;
    const edit = draftEditSchema.safeParse(editedPayload ?? undefined);
    if (!edit.success) bad("Sélection de lignes invalide.");
    const selected = edit.data
      ? payload.lines.filter((l) => edit.data!.selectedKeys.includes(l.key))
      : payload.lines;
    if (selected.length === 0) bad("Cochez au moins une ligne à reprendre dans le brouillon.");
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const customer = await tx.repairOrder
      .findFirst({ where: { id: payload.repairOrderId }, select: { customerId: true } })
      .then((o) => (o ? tx.customer.findFirst({ where: { id: o.customerId } }) : null));
    const discountRate = customer?.discountRate ?? undefined;
    const lines: QuoteLineInput[] = selected.map((l) => {
      const common = {
        description: l.description,
        quantity: l.quantity,
        isOptional: l.optional,
        priority: l.priority,
        groupKey: l.groupKey,
        groupLabel: l.groupLabel,
      };
      if (l.toPrice) return { ...common, type: "PART", unitPrice: 0 };
      return l.kind === "LABOR"
        ? { ...common, type: "LABOR", laborOperationId: l.catalogId!, discountRate }
        : { ...common, type: "PART", productId: l.catalogId!, discountRate };
    });
    const caller = await businessCaller(ctx);
    const created = await caller.quote.create({
      repairOrderId: payload.repairOrderId,
      origin: payload.inspectionId ? "INSPECTION" : "REPAIR_ORDER",
      lines,
    });
    // Rattachement des lignes aux points d'inspection (comme `createFromInspection`).
    if (payload.inspectionId) {
      await tx.quote.update({
        where: { id: created.id },
        data: { inspectionId: payload.inspectionId },
      });
    }
    const quoteLines = await tx.quoteLine.findMany({
      where: { quoteId: created.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    const itemIds = new Set<string>();
    for (const [index, line] of selected.entries()) {
      if (!line.inspectionItemId || !quoteLines[index]) continue;
      itemIds.add(line.inspectionItemId);
      await tx.quoteLine.update({
        where: { id: quoteLines[index]!.id },
        data: { inspectionItemId: line.inspectionItemId },
      });
    }
    if (itemIds.size) {
      await tx.inspectionItem.updateMany({
        where: { id: { in: [...itemIds] } },
        data: { addedToQuote: true },
      });
    }
    await writeAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      membershipId: ctx.membership.id,
      action: "quote.created_from_ai_draft",
      entity: "Quote",
      entityId: created.id,
      after: {
        aiSuggestionId: suggestion.id,
        repairOrderId: payload.repairOrderId,
        lines: selected.length,
        toPrice: selected.filter((l) => l.toPrice).length,
      } as Prisma.InputJsonValue,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    const original = payload.lines.map((l) => l.key).join("\n");
    const final = selected.map((l) => l.key).join("\n");
    return { result: { quoteId: created.id, number: created.number }, original, final };
  },
});

const explanationEditSchema = z
  .object({ groups: z.array(z.object({ key: z.string(), text: z.string().trim().max(600) })) })
  .optional();

registerAcceptHandler("quote_explanation", {
  permissions: ["quote:update"],
  async run({ ctx, suggestion, editedPayload }) {
    const payload = suggestion.payload as unknown as QuoteExplanationSuggestionPayload;
    const edit = explanationEditSchema.safeParse(editedPayload ?? undefined);
    if (!edit.success) bad("Explication invalide.");
    const edited = new Map((edit.data?.groups ?? []).map((g) => [g.key, g.text]));
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const quote = await tx.quote.findFirst({ where: { id: payload.quoteId, deletedAt: null } });
    if (!quote) quoteNotFound();
    requireSite(ctx, quote.siteId);
    if (quote.supersededAt)
      bad("Cette version est remplacée : générez l'explication sur la version courante.");
    const before = (quote.customerExplanation ?? null) as Record<string, string> | null;
    const validated: Record<string, string> = {};
    for (const g of payload.groups) {
      const text = (edited.get(g.key) ?? g.text).trim();
      if (text) validated[g.key] = text;
    }
    await tx.quote.update({
      where: { id: quote.id },
      data: { customerExplanation: validated as Prisma.InputJsonValue },
    });
    await writeAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      membershipId: ctx.membership.id,
      action: "quote.explanation_validated",
      entity: "Quote",
      entityId: quote.id,
      before: before as Prisma.InputJsonValue,
      after: { aiSuggestionId: suggestion.id, groups: Object.keys(validated).length },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return {
      result: { quoteId: quote.id, customerExplanation: validated },
      original: payload.groups.map((g) => g.text).join("\n"),
      final: payload.groups.map((g) => validated[g.key] ?? "").join("\n"),
    };
  },
});
