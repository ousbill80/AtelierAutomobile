import { db } from "@atelieros/db";

/**
 * Bus d'événements de domaine (01-architecture-technique.md §5) : une ligne `DomainEvent`
 * par événement, consommée par les modules abonnés (M10 rappels, M11 messages, M12 KPI…).
 * Les consommateurs sont idempotents (clé `eventId`).
 */
export async function emitDomainEvent(
  organizationId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const tenantDb = db.forTenant({ organizationId });
  const event = await tenantDb.domainEvent.create({
    data: { organizationId, type, payload },
    select: { id: true },
  });
  return event;
}
