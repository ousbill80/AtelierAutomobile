// RG-M10-22 : bus d'événements minimal. `DomainEvent` sert de file durable — les
// producteurs (ce module) insèrent une ligne dans la transaction de l'appelant ; le job
// `reminders.on_event` (apps/worker) la consomme par sondage et marque `processedAt`.
// Chaque effet décrit par RG-M10-22 est idempotent par `eventId` (= `DomainEvent.id`).
import type { db, Prisma } from "@atelieros/db";

type TenantDb = ReturnType<typeof db.forTenant>;

export type DomainEventType =
  | "appointment.created"
  | "appointment.cancelled"
  | "appointment.updated"
  | "appointment.confirmed"
  | "appointment.arrived"
  | "appointment.no_show"
  | "appointment.completed"
  | "repair_order.created"
  | "repair_order.status_changed"
  | "repair_order.line_added"
  | "repair_order.ready"
  | "repair_order.delivered"
  | "repair_order.cancelled"
  | "inspection.completed"
  | "vehicle.mileage_recorded"
  | "vehicle.inspection_updated"
  | "vehicle.service_recorded"
  | "vehicle.owner_changed"
  | "vehicle.insurance_updated"
  | "payment.received"
  | "payment.failed"
  | "payment.refunded"
  | "invoice.issued"
  | "invoice.voided"
  | "invoice.credit_note_issued"
  | "cash.session_closed"
  | "cash.session_not_closed"
  | "collection.promised"
  | "collection.disputed"
  | "collection.paused"
  | "collection.opened"
  | "collection.closed"
  | "collection.reopened"
  | "collection.resumed"
  | "collection.promise_kept"
  | "collection.promise_broken"
  | "quote.created"
  | "quote.sent"
  | "quote.viewed"
  | "quote.converted"
  | "quote.discount_approval_requested"
  | "quote.accepted"
  | "quote.declined"
  | "quote.expired"
  | "message.inbound_received"
  | "customer.updated";

/** Insère une ligne `DomainEvent` dans la transaction en cours. Ne fait rien d'autre. */
export async function emitDomainEvent(
  tx: TenantDb,
  organizationId: string,
  type: DomainEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.domainEvent.create({
    data: { organizationId, type, payload: payload as unknown as Prisma.InputJsonValue },
  });
}
