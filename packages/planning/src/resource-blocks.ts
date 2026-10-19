import {
  DomainError,
  formatAppointmentDateTime,
  overlaps,
  systemClock,
  type Clock,
} from "@atelieros/core";
import { db, writeAuditLog } from "@atelieros/db";
import type { Actor } from "./appointments";
import { loadPlanningContext } from "./context";
import { emitDomainEvent } from "./events";
import { notifyRoles } from "./notifications";

export interface CreateResourceBlockInput {
  siteId: string;
  bayId?: string | null;
  membershipId?: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  /** Vrai : les RDV en conflit passent « À affecter » (pont) ou perdent leur mécanicien, avec notification. */
  force?: boolean;
}

/**
 * Crée un blocage (pont, mécanicien, site). Sans `force`, refuse s'il existe des RDV en conflit
 * (`BLOCK_HAS_APPOINTMENTS { ids }`) pour proposer de les déplacer (M03 §8, §11).
 */
export async function createResourceBlock(
  actor: Actor,
  input: CreateResourceBlockInput,
  clock: Clock = systemClock,
) {
  const tenantDb = db.forTenant({ organizationId: actor.organizationId });
  const planning = await loadPlanningContext(actor.organizationId, input.siteId);
  const tz = planning.organization.timeZone;
  if (input.bayId && !planning.bays.some((b) => b.id === input.bayId)) {
    throw new DomainError("resource_block.bay_not_found", "Pont introuvable sur ce site.");
  }
  if (
    input.membershipId &&
    !planning.mechanics.some((m) => m.membershipId === input.membershipId)
  ) {
    throw new DomainError(
      "resource_block.mechanic_not_found",
      "Mécanicien introuvable sur ce site.",
    );
  }

  const candidates = await tenantDb.appointment.findMany({
    where: {
      siteId: input.siteId,
      status: { in: ["BOOKED", "CONFIRMED"] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      ...(input.bayId ? { bayId: input.bayId } : {}),
      ...(input.membershipId ? { mechanicId: input.membershipId } : {}),
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      bayId: true,
      mechanicId: true,
      customer: { select: { displayName: true } },
    },
  });
  const conflicting = candidates.filter((a) =>
    overlaps(a.startsAt, a.endsAt, input.startsAt, input.endsAt),
  );
  if (conflicting.length > 0 && !input.force) {
    throw new DomainError(
      "BLOCK_HAS_APPOINTMENTS",
      `${conflicting.length} rendez-vous sont prévus sur cette période. Déplacez-les ou confirmez pour les passer « À affecter ».`,
      { ids: conflicting.map((a) => a.id) },
    );
  }

  const block = await tenantDb.resourceBlock.create({
    data: {
      organizationId: actor.organizationId,
      siteId: input.siteId,
      bayId: input.bayId ?? null,
      membershipId: input.membershipId ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
      createdById: actor.membershipId,
    },
  });

  if (conflicting.length > 0) {
    // Les RDV en conflit perdent la ressource bloquée (pont → « À affecter », mécanicien → aucun)
    // et le chef d'atelier est prévenu pour les réaffecter (M03 §11).
    for (const appointment of conflicting) {
      await tenantDb.appointment.update({
        where: { id: appointment.id },
        data: {
          ...(input.bayId ? { bayId: null } : {}),
          ...(input.membershipId ? { mechanicId: null } : {}),
        },
      });
      await emitDomainEvent(actor.organizationId, "appointment.updated", {
        appointmentId: appointment.id,
        rescheduled: false,
        previousStartsAt: appointment.startsAt.toISOString(),
        startsAt: appointment.startsAt.toISOString(),
        unassignedBy: "resource_block",
        blockId: block.id,
      });
    }
    await notifyRoles({
      organizationId: actor.organizationId,
      roles: ["MANAGER", "OWNER"],
      siteId: input.siteId,
      type: "planning.block_unassigned",
      title: `${conflicting.length} RDV à réaffecter (${input.reason})`,
      body: conflicting
        .map((a) => `${a.customer.displayName} — ${formatAppointmentDateTime(a.startsAt, tz)}`)
        .join("\n"),
      link: `/rendez-vous`,
    });
  }

  await writeAuditLog({
    organizationId: actor.organizationId,
    userId: actor.userId,
    membershipId: actor.membershipId,
    siteId: input.siteId,
    action: "planning.block_created",
    entity: "ResourceBlock",
    entityId: block.id,
    after: block,
    reason: input.reason,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
  void clock;
  return { block, unassignedAppointmentIds: conflicting.map((a) => a.id) };
}

export async function deleteResourceBlock(actor: Actor, input: { id: string }) {
  const tenantDb = db.forTenant({ organizationId: actor.organizationId });
  const block = await tenantDb.resourceBlock.findFirst({ where: { id: input.id } });
  if (!block) {
    throw new DomainError("resource_block.not_found", "Blocage introuvable.");
  }
  await tenantDb.resourceBlock.delete({ where: { id: input.id } });
  await writeAuditLog({
    organizationId: actor.organizationId,
    userId: actor.userId,
    membershipId: actor.membershipId,
    siteId: block.siteId,
    action: "planning.block_deleted",
    entity: "ResourceBlock",
    entityId: block.id,
    before: block,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
  return block;
}
