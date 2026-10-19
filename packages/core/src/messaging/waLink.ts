// US-M11-02 : lien "Ouvrir dans WhatsApp" pour un canal wa_link (sans API, envoi humain)

/** `to` doit déjà être un numéro normalisé E.164 (`core/phone`), ex. "+2250747218890". */
export function buildWaLinkUrl(to: string, body: string): string {
  const digitsOnly = to.replace(/[^0-9]/g, "");
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(body)}`;
}
