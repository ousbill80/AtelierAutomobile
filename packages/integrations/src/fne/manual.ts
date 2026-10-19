import { DomainError } from "@atelieros/core";
import type { FneCertifyResult, FneInvoicePayload, FneProvider } from "./provider";

/**
 * Fournisseur FNE "manual" (01-architecture-technique.md §10) : il n'existe pas d'appel
 * programmatique à la DGI tant que l'API n'est pas branchée. `certify` lève volontairement
 * une erreur plutôt que de fabriquer un faux numéro FNE — un humain saisit le numéro et le
 * QR code obtenus sur la plateforme web DGI directement sur la facture (M08).
 */
export class ManualFneProvider implements FneProvider {
  async certify(_invoice: FneInvoicePayload): Promise<FneCertifyResult> {
    throw new DomainError(
      "fne.manual_mode_no_certify",
      "Mode FNE manuel : saisissez le numéro et le QR code obtenus sur la plateforme DGI, aucune certification automatique n'est disponible.",
    );
  }
}
