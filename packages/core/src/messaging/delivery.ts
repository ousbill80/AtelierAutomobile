// Accusé de réception d'un message (relance, document envoyé au client) : ce que l'on sait
// de sa remise, à partir des retours du fournisseur (webhooks DELIVERED / READ). Les coches
// suivent la convention WhatsApp : ✓ envoyé, ✓✓ reçu, ✓✓ (bleu) lu.

export type DeliveryState =
  | "pending" // pas encore parti
  | "sent" // parti, le fournisseur n'a pas (encore) confirmé la remise
  | "delivered" // remis sur le téléphone / dans la boîte du client
  | "read" // lu / ouvert par le client
  | "failed" // échec définitif
  | "manual" // envoyé à la main (lien WhatsApp) : pas d'accusé possible
  | "simulated"; // mode test (fournisseur console) : rien n'est réellement parti

export interface DeliveryInput {
  status: string;
  provider: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
}

export function deliveryState(message: DeliveryInput): DeliveryState {
  if (message.status === "FAILED") return "failed";
  if (message.readAt || message.status === "READ") return "read";
  if (message.deliveredAt || message.status === "DELIVERED") return "delivered";
  if (message.status === "QUEUED" || message.status === "SENDING") return "pending";
  if (message.provider === "wa_link") return "manual";
  if (message.provider === "console") return "simulated";
  return "sent";
}

/** Envoyé (vraiment) mais sans accusé de remise depuis plus de `hours` heures : à vérifier. */
export function isUnconfirmed(message: DeliveryInput, now: Date, hours = 2): boolean {
  return (
    deliveryState(message) === "sent" &&
    !!message.sentAt &&
    now.getTime() - message.sentAt.getTime() > hours * 3_600_000
  );
}
