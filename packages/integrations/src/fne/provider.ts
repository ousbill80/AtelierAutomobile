export interface FneInvoicePayload {
  invoiceId: string;
  number: string;
  issuedAt: Date;
  totalTtc: number;
  totalVat: number;
  customer: { name: string; taxId?: string };
}

export interface FneCertifyResult {
  fneNumber: string;
  qrCode: string;
  signedAt: Date;
  raw: unknown;
}

/**
 * 01-architecture-technique.md §10. Note FNE : la spécification exacte de l'API DGI doit
 * être obtenue auprès de la DGI lors de l'inscription du garage. Tant qu'elle n'est pas
 * branchée (FneConfig.mode = "api"), le mode "manual" est utilisé : un humain saisit le
 * numéro et le QR code obtenus sur la plateforme web DGI, sans appel programmatique.
 */
export interface FneProvider {
  certify(invoice: FneInvoicePayload): Promise<FneCertifyResult>;
  cancel?(fneNumber: string, reason: string): Promise<void>;
}
