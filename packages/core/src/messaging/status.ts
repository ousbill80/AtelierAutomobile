// RG-M11-11 : mise à jour monotone du statut d'un message sortant (les webhooks arrivent dans le désordre)

export type OutboundMessageStatus = "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

const RANK: Record<Exclude<OutboundMessageStatus, "FAILED">, number> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
};

/**
 * Renvoie le statut à retenir face à un nouvel événement (webhook, retour fournisseur).
 * Un statut n'écrase jamais un statut plus avancé ; `FAILED` n'écrase que `QUEUED|SENDING|SENT`.
 */
export function nextStatus(
  current: OutboundMessageStatus,
  incoming: OutboundMessageStatus,
): OutboundMessageStatus {
  if (incoming === "FAILED") {
    if (current === "QUEUED" || current === "SENDING" || current === "SENT") {
      return "FAILED";
    }
    return current;
  }
  if (current === "FAILED") {
    // un FAILED déjà posé n'est repris que par un repli (nouveau Message), jamais réécrit en place
    return current;
  }
  return RANK[incoming] > RANK[current] ? incoming : current;
}
