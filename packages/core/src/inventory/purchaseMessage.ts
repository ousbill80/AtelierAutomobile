// US-M07-07 — texte du bon de commande envoyé au fournisseur (WhatsApp, email, lien wa.me).
import { formatFCFA } from "../money/format";
import { formatQty } from "./units";

export interface PurchaseMessageInput {
  garageName: string;
  siteName: string;
  number: string;
  supplierName: string;
  expectedAt?: string | null; // dd/MM/yyyy
  lines: {
    sku: string;
    name: string;
    unit: string;
    quantity: number; // unités de base
    quantityScale: number;
    unitCost: number;
  }[];
  total: number;
}

export function buildPurchaseOrderMessage(input: PurchaseMessageInput): {
  subject: string;
  body: string;
} {
  const lines = input.lines.map(
    (l) =>
      `- ${formatQty(l.quantity, l.quantityScale)} ${l.unit} × ${l.name} (réf. ${l.sku}) à ${formatFCFA(l.unitCost)}`,
  );
  const body = [
    `Bonjour ${input.supplierName},`,
    "",
    `${input.garageName} (${input.siteName}) vous passe la commande ${input.number} :`,
    ...lines,
    "",
    `Total HT : ${formatFCFA(input.total)}`,
    ...(input.expectedAt ? [`Livraison souhaitée le ${input.expectedAt}.`] : []),
    "",
    "Merci de confirmer la disponibilité et le délai.",
  ].join("\n");
  return { subject: `Bon de commande ${input.number} — ${input.garageName}`, body };
}
