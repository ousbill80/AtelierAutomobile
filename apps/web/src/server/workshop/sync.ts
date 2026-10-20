// M06 §8 `tech.sync` — applique la file d'opérations de la tablette (RG-M06-13/14) : lot
// ordonné par `seq`, une transaction par opération (rejet partiel possible), idempotence par
// `clientOpId` (journal `TechSyncOperation`), correction d'horloge, conflits.
import {
  correctTimestamp,
  lastWriteWins,
  measureClockOffset,
  orderSyncBatch,
} from "@atelieros/core";
import { db, type ScopedTenantClient } from "@atelieros/db";
import type { TechOp } from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import type { OrgRoContext } from "../repairOrders/helpers";
import { completeInspectionTx, saveInspectionItemTx } from "../routers/inspection";
import {
  addNote,
  clockIn,
  clockOut,
  completeTask,
  createPartRequest,
  opPermission,
  pauseTask,
  rejectionMessage,
  resumeTask,
  startTask,
  type OpContext,
} from "./tasks";

type Tx = ScopedTenantClient;

export interface SyncCaller {
  organizationId: string;
  membershipId: string;
  permissions: ReadonlySet<string>;
  allowedSiteIds: string[] | "ALL";
  activeSiteId: string | null;
}

export interface SyncResult {
  clientOpId: string;
  status: "ok" | "rejected";
  error?: string;
  entityId?: string | null;
  /** Erreur technique (non journalisée) : l'opération reste dans la file de la tablette. */
  retry?: boolean;
}

export type SyncOp = TechOp;

async function applyOp(
  tx: Tx,
  op: SyncOp,
  ctx: OpContext,
  caller: SyncCaller,
): Promise<{ entityId: string | null; rejected?: string }> {
  switch (op.type) {
    case "task.start":
      return { entityId: (await startTask(tx, ctx, op.lineId)).id };
    case "task.pause":
      return { entityId: (await pauseTask(tx, ctx, op.lineId, op.reason))?.id ?? null };
    case "task.resume":
      return { entityId: (await resumeTask(tx, ctx, op.lineId)).id };
    case "task.complete": {
      const { line, rejected } = await completeTask(tx, ctx, op.lineId, op.note);
      return { entityId: line.id, rejected: rejected ?? undefined };
    }
    case "note.add":
      return {
        entityId: (await addNote(tx, ctx, op.lineId, op.body, op.visibleToCustomer)).id,
      };
    case "photo.attach": {
      const attachment = await tx.attachment.findFirst({
        where: { id: op.attachmentId, entity: "repair_order_line", entityId: op.lineId },
      });
      if (!attachment) return { entityId: null, rejected: "Photo introuvable : renvoyez-la." };
      return { entityId: attachment.id };
    }
    case "inspection.setItem": {
      // RG-M06-14 : dernier écrit gagne par point (horodatage corrigé de l'opération).
      const last = await tx.techSyncOperation.findFirst({
        where: { type: "inspection.setItem", entityId: op.itemId, status: "ok" },
        orderBy: { appliedAt: "desc" },
      });
      if (!lastWriteWins(last?.appliedAt ?? null, ctx.at)) return { entityId: op.itemId };
      await saveInspectionItemTx(tx, ctx, op);
      return { entityId: op.itemId };
    }
    case "inspection.complete":
      await completeInspectionTx(tx, ctx, op.inspectionId, ctx.serverNow);
      return { entityId: op.inspectionId };
    case "attendance.in":
      return { entityId: (await clockIn(tx, ctx, caller.activeSiteId)).id };
    case "attendance.out":
      return { entityId: (await clockOut(tx, ctx))?.id ?? null };
    case "partRequest.create":
      return {
        entityId: (
          await createPartRequest(tx, ctx, {
            repairOrderId: op.repairOrderId,
            lineId: op.lineId,
            productId: op.productId,
            freeText: op.freeText,
            quantity: op.quantity,
            urgency: op.urgency,
          })
        ).id,
      };
  }
}

function errorMessage(error: unknown): string | null {
  const domain = rejectionMessage(error);
  if (domain) return domain;
  if (error instanceof TRPCError && error.code !== "INTERNAL_SERVER_ERROR") return error.message;
  return null;
}

export async function syncTechOps(
  caller: SyncCaller,
  org: OrgRoContext,
  input: {
    deviceId: string;
    deviceNow: Date;
    previousOffsetMs?: number | null;
    ops: SyncOp[];
  },
  serverNow: Date,
): Promise<{ serverNow: Date; serverOffsetMs: number; results: SyncResult[] }> {
  const correction = measureClockOffset(serverNow, input.deviceNow, input.previousOffsetMs);
  const tenantDb = db.forTenant({ organizationId: caller.organizationId });
  const results: SyncResult[] = [];

  for (const op of orderSyncBatch(input.ops)) {
    const at = correctTimestamp(op.at, correction.offsetMs, serverNow);
    // Idempotence : une opération déjà appliquée (ou refusée) renvoie son résultat.
    const known = await tenantDb.techSyncOperation.findFirst({
      where: { clientOpId: op.clientOpId },
    });
    if (known) {
      results.push({
        clientOpId: op.clientOpId,
        status: known.status === "rejected" ? "rejected" : "ok",
        error: known.error ?? undefined,
        entityId: known.entityId,
      });
      continue;
    }

    const record = (status: "ok" | "rejected", entityId: string | null, error?: string) => ({
      organizationId: caller.organizationId,
      clientOpId: op.clientOpId,
      membershipId: op.actorMembershipId,
      deviceId: input.deviceId,
      type: op.type,
      status,
      error: error ?? null,
      entityId,
      deviceAt: op.at,
      appliedAt: at,
    });

    // RG-M06-15 : l'acteur est le mécanicien identifié ; pointer pour un autre = time:edit.
    let refusal: string | null = null;
    if (op.actorMembershipId !== caller.membershipId && !caller.permissions.has("time:edit")) {
      refusal = "Action non autorisée pour ce mécanicien.";
    } else if (!opPermission(op.type).some((p) => caller.permissions.has(p))) {
      refusal = "Vous n'avez pas l'autorisation de faire cette action.";
    }
    if (refusal) {
      await tenantDb.techSyncOperation.create({ data: record("rejected", null, refusal) });
      results.push({ clientOpId: op.clientOpId, status: "rejected", error: refusal });
      continue;
    }

    const ctx: OpContext = {
      organizationId: caller.organizationId,
      actorId: op.actorMembershipId,
      permissions: caller.permissions,
      allowedSiteIds: caller.allowedSiteIds,
      org,
      at,
      serverNow,
      offline: op.offline === true,
      deviceId: input.deviceId,
      clientOpId: op.clientOpId,
      clockSuspicious: correction.suspicious,
    };
    try {
      const outcome = await tenantDb.transaction(async (tx) => {
        const applied = await applyOp(tx, op, ctx, caller);
        await tx.techSyncOperation.create({
          data: record(applied.rejected ? "rejected" : "ok", applied.entityId, applied.rejected),
        });
        return applied;
      });
      results.push(
        outcome.rejected
          ? {
              clientOpId: op.clientOpId,
              status: "rejected",
              error: outcome.rejected,
              entityId: outcome.entityId,
            }
          : { clientOpId: op.clientOpId, status: "ok", entityId: outcome.entityId },
      );
    } catch (error) {
      const message = errorMessage(error);
      if (!message) {
        // Erreur technique : non journalisée, la tablette retentera la même opération.
        results.push({
          clientOpId: op.clientOpId,
          status: "rejected",
          error: "Erreur temporaire du serveur : nouvel essai à la prochaine synchronisation.",
          retry: true,
        });
        continue;
      }
      await tenantDb.techSyncOperation.create({ data: record("rejected", null, message) });
      results.push({ clientOpId: op.clientOpId, status: "rejected", error: message });
    }
  }
  return { serverNow, serverOffsetMs: correction.offsetMs, results };
}
