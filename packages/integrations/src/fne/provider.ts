import { DomainError, type FneErrorKind, type FneInvoicePayload } from "@atelieros/core";

export type { FneInvoicePayload } from "@atelieros/core";

export interface FneCertifyResult {
  fneNumber: string;
  qrCode: string;
  signedAt: Date;
  raw: unknown;
}

export interface FneHealthStatus {
  ok: boolean;
  detail: string;
}

/**
 * Erreur d'un adaptateur FNE. `kind = "transient"` (réseau, service DGI indisponible) : reprise
 * automatique avec backoff ; `kind = "rejected"` (rejet de validation renvoyé par la DGI) : pas de
 * reprise automatique, l'erreur est affichée pour correction (RG-M08-15).
 */
export class FneProviderError extends DomainError {
  readonly kind: FneErrorKind;

  constructor(kind: FneErrorKind, message: string, details?: Record<string, unknown>) {
    super(kind === "rejected" ? "fne.rejected" : "fne.unavailable", message, details);
    this.name = "FneProviderError";
    this.kind = kind;
  }
}

/**
 * 01-architecture-technique.md §10. Note FNE : la spécification exacte de l'API DGI doit
 * être obtenue auprès de la DGI lors de l'inscription du garage. Tant qu'elle n'est pas
 * branchée (FneConfig.mode = "api"), le mode "manual" est utilisé : un humain saisit le
 * numéro et le QR code obtenus sur la plateforme web DGI, sans appel programmatique.
 */
export interface FneProvider {
  /** `invoice.idempotencyKey` est transmise si la spécification le permet (RG-M08-15). */
  certify(invoice: FneInvoicePayload): Promise<FneCertifyResult>;
  cancel?(fneNumber: string, reason: string): Promise<void>;
  /** « Tester la certification » (RG-M15-18) : test d'authentification, sans facture réelle. */
  healthCheck?(): Promise<FneHealthStatus>;
}
