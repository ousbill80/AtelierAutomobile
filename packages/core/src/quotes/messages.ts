// US-M05-04 / US-M05-07 — messages pré-rédigés (envoi du devis, confirmation d'un accord oral).
import { formatFCFA } from "../money/format";

export interface QuoteSendMessageInput {
  customerName: string;
  number: string;
  vehicleLabel: string | null;
  total: number;
  urgentTotal: number;
  link: string;
  garageName: string;
}

export function quoteSendMessage(input: QuoteSendMessageInput): string {
  const vehicle = input.vehicleLabel ? ` pour votre ${input.vehicleLabel}` : "";
  const urgent = input.urgentTotal > 0 ? ` (dont ${formatFCFA(input.urgentTotal)} urgents)` : "";
  return `Bonjour ${input.customerName}, voici le devis ${input.number}${vehicle} : ${formatFCFA(input.total)} TTC${urgent}. Consultez-le et validez les travaux ici : ${input.link} — ${input.garageName}`;
}

export interface PhoneConfirmationInput {
  time: string;
  accepted: { label: string; total: number }[];
  declined: { label: string }[];
}

export function phoneConfirmationMessage(input: PhoneConfirmationInput): string {
  const accepted =
    input.accepted.length > 0
      ? input.accepted.map((a) => `${a.label} (${formatFCFA(a.total)} TTC)`).join(", ")
      : "aucun travail";
  const declined =
    input.declined.length > 0
      ? ` Refusé : ${input.declined.map((d) => d.label).join(", ")}.`
      : "";
  return `Suite à notre appel de ${input.time}, vous avez accepté : ${accepted}.${declined} Si ce n'est pas correct, répondez à ce message.`;
}
