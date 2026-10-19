// M06 — opérations atelier sur la base (pointage, présence, remarques, demandes de pièces),
// partagées par la synchronisation de la tablette (`tech.sync`) et les routeurs. Les décisions
// (durées, pauses, chevauchements, conflits) viennent de `@atelieros/core` (workshop).
import {
  assertTaskStartable,
  businessDate,
  decideLineOp,
  isDomainError,
  pauseEntry,
  planStartOverlap,
  resumeEntry,
  stopEntry,
  type PauseReason,
  type TechOpType,
} from "@atelieros/core";
import {
  issueReservedForLine,
  loadStockContext,
  syncRepairOrderStock,
  type Prisma,
  type RepairOrder,
  type RepairOrderLine,
  type ScopedTenantClient,
  type TimeEntry,
} from "@atelieros/db";
import { emitDomainEvent } from "../events/emit";
import { membersWithRoles, notify, type OrgRoContext } from "../repairOrders/helpers";
import { afterLineChange, type SystemCtx } from "../repairOrders/lines";

type Tx = ScopedTenantClient;

/** Refus métier d'une opération : message français affiché sur la tablette. */
export class OpRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpRejected";
  }
}

export function reject(message: string): never {
  throw new OpRejected(message);
}

export function rejectionMessage(error: unknown): string | null {
  if (error instanceof OpRejected) return error.message;
  if (isDomainError(error)) return error.message;
  return null;
}

export interface OpContext {
  organizationId: string;
  /** Mécanicien qui agit (US-M06-04 : identifié par session ou PIN). */
  actorId: string;
  permissions: ReadonlySet<string>;
  allowedSiteIds: string[] | "ALL";
  org: OrgRoContext;
  /** Heure corrigée de l'opération (RG-M06-14). */
  at: Date;
  serverNow: Date;
  /** Opération mise en file hors-ligne : pointage accepté même si la ligne a changé. */
  offline: boolean;
  deviceId: string | null;
  clientOpId: string;
  /** Horloge de la tablette suspecte (§11) : les entrées créées sont signalées. */
  clockSuspicious: boolean;
}

function systemCtx(ctx: OpContext): SystemCtx {
  return {
    organizationId: ctx.organizationId,
    permissions: ctx.permissions as SystemCtx["permissions"],
    membership: { id: ctx.actorId },
  };
}

function siteAllowed(ctx: Pick<OpContext, "allowedSiteIds">, siteId: string): boolean {
  return ctx.allowedSiteIds === "ALL" || ctx.allowedSiteIds.includes(siteId);
}

export async function loadLineForOp(
  tx: Tx,
  ctx: OpContext,
  lineId: string,
): Promise<{ line: RepairOrderLine; order: RepairOrder }> {
  const line = await tx.repairOrderLine.findFirst({ where: { id: lineId } });
  if (!line) reject("Tâche introuvable.");
  const order = await tx.repairOrder.findFirst({ where: { id: line.repairOrderId } });
  if (!order || !siteAllowed(ctx, order.siteId)) reject("Tâche introuvable.");
  return { line, order };
}

async function openEntryOnLine(tx: Tx, actorId: string, lineId: string) {
  return tx.timeEntry.findFirst({
    where: { membershipId: actorId, repairOrderLineId: lineId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
}

/** Une ligne reprise après un contrôle qualité refusé se pointe en REWORK (US-M06-10). */
async function entryKind(tx: Tx, line: RepairOrderLine): Promise<"WORK" | "REWORK"> {
  const failed = await tx.qualityCheck.count({
    where: { repairOrderId: line.repairOrderId, result: "FAILED", reworkLineIds: { has: line.id } },
  });
  return failed > 0 ? "REWORK" : "WORK";
}

function review(...reasons: (string | false | null | undefined)[]): string | null {
  const list = reasons.filter((r): r is string => !!r);
  return list.length > 0 ? list.join(", ") : null;
}

/**
 * `task.start` — US-M06-05 : crée un `TimeEntry`, la ligne passe IN_PROGRESS, l'OR APPROVED →
 * IN_PROGRESS (M04). RG-M06-06 : l'éventuelle tâche active du mécanicien est mise en pause.
 */
export async function startTask(tx: Tx, ctx: OpContext, lineId: string): Promise<TimeEntry> {
  const { line, order } = await loadLineForOp(tx, ctx, lineId);
  const decision = decideLineOp("task.start", line.status);
  if (decision.action === "reject") reject(decision.message);
  let lenient = decision.needsReview;
  if (!decision.needsReview) {
    try {
      assertTaskStartable(line, order.status);
    } catch (error) {
      // RG-M06-14 : un pointage fait hors-ligne est conservé (temps réel passé), à revoir.
      if (!ctx.offline) throw error;
      lenient = true;
    }
  }

  const current = await openEntryOnLine(tx, ctx.actorId, line.id);
  if (current) {
    // Déjà pointé sur cette ligne : « Démarrer » vaut reprise si l'entrée est en pause.
    if (current.pausedAt) return resumeOpenEntry(tx, ctx, current);
    return current;
  }

  const others = await tx.timeEntry.findMany({
    where: {
      membershipId: ctx.actorId,
      OR: [{ endedAt: null }, { endedAt: { gt: ctx.at } }, { startedAt: { gt: ctx.at } }],
    },
  });
  const plan = planStartOverlap(others, ctx.at);
  for (const p of plan.pause) {
    const entry = others.find((e) => e.id === p.id)!;
    const patch = pauseEntry(entry, p.at, "other");
    if (patch) await tx.timeEntry.update({ where: { id: entry.id }, data: patch });
  }
  for (const t of plan.truncate) {
    await tx.timeEntry.update({
      where: { id: t.id },
      data: { endedAt: t.endedAt, pausedAt: null, needsReview: true, reviewReason: "overlap" },
    });
  }
  const reviewReason = review(
    decision.needsReview && "line_cancelled",
    lenient && !decision.needsReview && "line_not_workable",
    plan.needsReview && "overlap",
    ctx.clockSuspicious && "clock_skew",
  );
  const entry = await tx.timeEntry.create({
    data: {
      organizationId: ctx.organizationId,
      membershipId: ctx.actorId,
      repairOrderId: order.id,
      repairOrderLineId: line.id,
      startedAt: ctx.at,
      endedAt: plan.incomingEndedAt,
      source: ctx.offline ? "offline-sync" : "tablet",
      kind: await entryKind(tx, line),
      clientOpId: ctx.clientOpId,
      deviceId: ctx.deviceId,
      needsReview: reviewReason !== null,
      reviewReason,
    },
  });
  if (line.status === "PENDING" && !lenient) {
    await tx.repairOrderLine.update({ where: { id: line.id }, data: { status: "IN_PROGRESS" } });
    await afterLineChange(tx, systemCtx(ctx), ctx.org, order.id, ctx.serverNow);
  }
  await emitDomainEvent(tx as never, ctx.organizationId, "workshop.task_started", {
    repairOrderId: order.id,
    lineId: line.id,
    membershipId: ctx.actorId,
    timeEntryId: entry.id,
  });
  return entry;
}

async function resumeOpenEntry(tx: Tx, ctx: OpContext, entry: TimeEntry): Promise<TimeEntry> {
  // RG-M06-06 : reprendre une tâche met en pause l'éventuelle autre tâche active.
  const running = await tx.timeEntry.findMany({
    where: { membershipId: ctx.actorId, endedAt: null, pausedAt: null, id: { not: entry.id } },
  });
  for (const r of running) {
    const patch = pauseEntry(r, ctx.at, "other");
    if (patch) await tx.timeEntry.update({ where: { id: r.id }, data: patch });
  }
  const patch = resumeEntry(entry, ctx.at);
  if (!patch) return entry;
  return tx.timeEntry.update({ where: { id: entry.id }, data: patch });
}

/** `task.pause` — RG-M06-07 : `pausedAt`, `pauseReason`. */
export async function pauseTask(
  tx: Tx,
  ctx: OpContext,
  lineId: string,
  reason: PauseReason,
): Promise<TimeEntry | null> {
  const { line } = await loadLineForOp(tx, ctx, lineId);
  const entry = await openEntryOnLine(tx, ctx.actorId, line.id);
  if (!entry) {
    if (ctx.offline) return null;
    reject("Aucun pointage en cours sur cette tâche.");
  }
  const patch = pauseEntry(entry, ctx.at, reason);
  if (!patch) return entry;
  return tx.timeEntry.update({ where: { id: entry.id }, data: patch });
}

/** `task.resume` — RG-M06-07 ; sans entrée ouverte (close par le worker) : nouveau départ. */
export async function resumeTask(tx: Tx, ctx: OpContext, lineId: string): Promise<TimeEntry> {
  const { line } = await loadLineForOp(tx, ctx, lineId);
  const entry = await openEntryOnLine(tx, ctx.actorId, line.id);
  if (!entry) return startTask(tx, ctx, lineId);
  return resumeOpenEntry(tx, ctx, entry);
}

/**
 * `task.complete` — US-M06-05 : clôt l'entrée, la ligne passe DONE (sortie des pièces réservées,
 * RG-M04-09), remarque éventuelle ; dernière ligne → OR en contrôle qualité (M04).
 */
export async function completeTask(
  tx: Tx,
  ctx: OpContext,
  lineId: string,
  note?: string,
): Promise<{ line: RepairOrderLine; rejected: string | null }> {
  const { line, order } = await loadLineForOp(tx, ctx, lineId);
  const decision = decideLineOp("task.complete", line.status);
  const entry = await openEntryOnLine(tx, ctx.actorId, line.id);
  if (entry) {
    const patch = stopEntry(entry, ctx.at);
    // RG-M06-14 : ligne annulée par le bureau → le temps est gardé mais signalé.
    const flag =
      decision.action === "reject" ? { needsReview: true, reviewReason: "line_cancelled" } : {};
    if (patch) await tx.timeEntry.update({ where: { id: entry.id }, data: { ...patch, ...flag } });
  }
  // Refus sans annuler la transaction : la clôture du pointage ci-dessus est conservée.
  if (decision.action === "reject") return { line, rejected: decision.message };
  if (line.status === "DONE") return { line, rejected: null };
  assertTaskStartable({ ...line, status: "IN_PROGRESS" }, order.status);
  // Binôme (RG-M06-06) : les autres pointages ouverts sur la ligne sont clos aussi.
  const partners = await tx.timeEntry.findMany({
    where: { repairOrderLineId: line.id, endedAt: null },
  });
  for (const p of partners) {
    const patch = stopEntry(p, ctx.at);
    if (patch) await tx.timeEntry.update({ where: { id: p.id }, data: patch });
  }
  const updated = await tx.repairOrderLine.update({
    where: { id: line.id },
    data: { status: "DONE", completedAt: ctx.serverNow, completedById: ctx.actorId },
  });
  const stock = await loadStockContext(ctx.organizationId);
  await syncRepairOrderStock(tx, stock, order.id, ctx.serverNow, ctx.actorId);
  await issueReservedForLine(tx, stock, line.id, ctx.serverNow, ctx.actorId);
  if (note?.trim()) {
    await tx.workNote.create({
      data: {
        organizationId: ctx.organizationId,
        repairOrderId: order.id,
        repairOrderLineId: line.id,
        authorId: ctx.actorId,
        body: note.trim(),
      },
    });
  }
  await emitDomainEvent(tx as never, ctx.organizationId, "workshop.task_completed", {
    repairOrderId: order.id,
    lineId: line.id,
    membershipId: ctx.actorId,
  });
  await afterLineChange(tx, systemCtx(ctx), ctx.org, order.id, ctx.serverNow);
  return { line: updated, rejected: null };
}

/** `note.add` — US-M06-06 : remarque interne ou « visible client » (validée par le conseiller). */
export async function addNote(
  tx: Tx,
  ctx: OpContext,
  lineId: string,
  body: string,
  visibleToCustomer: boolean,
) {
  const { line, order } = await loadLineForOp(tx, ctx, lineId);
  return tx.workNote.create({
    data: {
      organizationId: ctx.organizationId,
      repairOrderId: order.id,
      repairOrderLineId: line.id,
      authorId: ctx.actorId,
      body,
      visibleToCustomer,
      clientOpId: ctx.clientOpId,
    },
  });
}

/** Membership.siteIds vide = tous les sites : le site de pointage est celui de la session. */
async function attendanceSiteId(tx: Tx, ctx: OpContext, activeSiteId: string | null) {
  if (activeSiteId) return activeSiteId;
  const site = await tx.site.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return site?.id ?? null;
}

/** `attendance.in` — US-M06-09 : une seule présence par jour (pas de doublon). */
export async function clockIn(tx: Tx, ctx: OpContext, activeSiteId: string | null) {
  const date = businessDate(ctx.at, ctx.org.timeZone);
  const existing = await tx.attendance.findFirst({
    where: { membershipId: ctx.actorId, date },
  });
  if (existing) {
    if (existing.clockOut) {
      // Retour après un départ : la présence reprend (le départ est annulé).
      return tx.attendance.update({ where: { id: existing.id }, data: { clockOut: null } });
    }
    return existing;
  }
  return tx.attendance.create({
    data: {
      organizationId: ctx.organizationId,
      membershipId: ctx.actorId,
      date,
      clockIn: ctx.at,
      siteId: await attendanceSiteId(tx, ctx, activeSiteId),
    },
  });
}

/** `attendance.out` — US-M06-09 : la tâche en cours est mise en pause automatiquement. */
export async function clockOut(tx: Tx, ctx: OpContext) {
  const date = businessDate(ctx.at, ctx.org.timeZone);
  const attendance = await tx.attendance.findFirst({
    where: { membershipId: ctx.actorId, date },
  });
  if (!attendance) {
    if (ctx.offline) return null;
    reject("Pointez d'abord votre arrivée.");
  }
  const running = await tx.timeEntry.findMany({
    where: { membershipId: ctx.actorId, endedAt: null, pausedAt: null },
  });
  for (const r of running) {
    const patch = pauseEntry(r, ctx.at, "other");
    if (patch) await tx.timeEntry.update({ where: { id: r.id }, data: patch });
  }
  if (attendance.clockOut) return attendance;
  return tx.attendance.update({ where: { id: attendance.id }, data: { clockOut: ctx.at } });
}

export interface PartRequestDraft {
  repairOrderId: string;
  lineId?: string;
  productId?: string;
  freeText?: string;
  quantity: number;
  urgency: "LOW" | "NORMAL" | "HIGH" | "URGENT";
}

/** US-M06-07 : demande de pièce → magasinier notifié (traitée dans M07). */
export async function createPartRequest(
  tx: Tx,
  ctx: Pick<OpContext, "organizationId" | "actorId" | "allowedSiteIds"> & {
    clientOpId?: string | null;
  },
  draft: PartRequestDraft,
) {
  if (!draft.productId && !draft.freeText?.trim()) reject("Choisissez une pièce ou décrivez-la.");
  const order = await tx.repairOrder.findFirst({ where: { id: draft.repairOrderId } });
  if (!order || !siteAllowed(ctx, order.siteId)) reject("Ordre de réparation introuvable.");
  if (draft.lineId) {
    const line = await tx.repairOrderLine.findFirst({
      where: { id: draft.lineId, repairOrderId: order.id },
    });
    if (!line) reject("Tâche introuvable.");
  }
  let productName: string | null = null;
  if (draft.productId) {
    const product = await tx.product.findFirst({ where: { id: draft.productId } });
    if (!product) reject("Pièce introuvable.");
    productName = product.name;
  }
  const request = await tx.partRequest.create({
    data: {
      organizationId: ctx.organizationId,
      siteId: order.siteId,
      repairOrderId: order.id,
      repairOrderLineId: draft.lineId ?? null,
      requestedById: ctx.actorId,
      productId: draft.productId ?? null,
      freeText: draft.freeText?.trim() || null,
      quantity: draft.quantity,
      urgency: draft.urgency,
      clientOpId: ctx.clientOpId ?? null,
    },
  });
  await notify(tx, ctx.organizationId, await membersWithRoles(tx, ["STOREKEEPER"]), {
    type: "part_request.created",
    title: `Demande de pièce — ${order.number} : ${productName ?? draft.freeText ?? ""} × ${draft.quantity}`,
    link: "/atelier/pieces",
  });
  await emitDomainEvent(tx as never, ctx.organizationId, "part_request.created", {
    partRequestId: request.id,
    repairOrderId: order.id,
  });
  return request;
}

/** Permission requise pour chaque type d'opération de la tablette (§10). */
export function opPermission(type: TechOpType): string[] {
  switch (type) {
    case "task.start":
    case "task.pause":
    case "task.resume":
    case "task.complete":
    case "attendance.in":
    case "attendance.out":
      return ["time:clock", "time:edit"];
    case "note.add":
    case "photo.attach":
      return ["time:clock", "inspection:perform"];
    case "inspection.setItem":
    case "inspection.complete":
      return ["inspection:perform"];
    case "partRequest.create":
      return ["partrequest:create"];
  }
}

export type TimeEntryUpdate = Prisma.TimeEntryUpdateInput;
