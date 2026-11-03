// M09 RG-M09-16 — mise en demeure de payer : délai, nom du fichier, modes de remise et
// « accusé de réception » (date et mode de remise). Le contenu est un modèle : la plateforme
// ne fournit pas de conseil juridique.

export const DEFAULT_FORMAL_NOTICE_DELAY_DAYS = 8;
export const DEFAULT_FORMAL_NOTICE_CLOSING =
  "À défaut de règlement dans ce délai, nous nous réservons le droit d'engager toute procédure de recouvrement prévue par la loi.";

/** Modes de remise : envoi électronique (accusé fourni par le fournisseur) ou remise physique. */
export const FORMAL_NOTICE_METHODS = [
  "email",
  "whatsapp",
  "hand",
  "bailiff",
  "registered_mail",
] as const;
export type FormalNoticeMethod = (typeof FORMAL_NOTICE_METHODS)[number];

/** Date limite de paiement : date de la mise en demeure + délai (jours calendaires, UTC). */
export function formalNoticeDeadline(
  issuedOn: Date,
  delayDays = DEFAULT_FORMAL_NOTICE_DELAY_DAYS,
): Date {
  return new Date(issuedOn.getTime() + Math.max(1, Math.trunc(delayDays)) * 86_400_000);
}

export function formalNoticeFileName(customerName: string, issuedOn: Date): string {
  const slug = customerName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `Mise-en-demeure-${slug || "client"}-${issuedOn.toISOString().slice(0, 10)}.pdf`;
}

/**
 * Une remise est valide si sa date n'est ni avant la mise en demeure ni dans le futur.
 * Retourne le message d'erreur (français) ou null.
 */
export function formalNoticeDeliveryError(input: {
  deliveredOn: Date;
  issuedAt: Date | null;
  today: Date;
}): string | null {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (day(input.deliveredOn) > day(input.today)) {
    return "La date de remise ne peut pas être dans le futur.";
  }
  if (input.issuedAt && day(input.deliveredOn) < day(input.issuedAt)) {
    return "La date de remise ne peut pas précéder la mise en demeure.";
  }
  return null;
}
