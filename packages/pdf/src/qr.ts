import QRCode from "qrcode";

/** QR carré (PNG) pour un lien ou un texte de vérification. */
export function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, { margin: 1, width: 240, errorCorrectionLevel: "M" });
}
