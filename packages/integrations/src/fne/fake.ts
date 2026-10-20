import type { FneInvoicePayload } from "@atelieros/core";
import { FneProviderError, type FneCertifyResult, type FneProvider } from "./provider";

export interface FakeFneOptions {
  /** Nombre d'appels qui échouent (erreur transitoire) avant de réussir. */
  failTimes?: number;
  /** Rejette toute facture avec ce message (rejet « définitif » DGI). */
  rejectWith?: string;
  /** Horloge des certificats ; par défaut, la date d'émission de la facture (déterministe). */
  signedAt?: () => Date;
}

/**
 * Simulateur FNE (`FneConfig.provider = "fake"`) pour le local, les tests et les démos : aucun
 * compte DGI requis (CLAUDE.md). Numéro `SIM-…` et QR « simulé » déterministes, clairement
 * reconnaissables, jamais valables fiscalement — refusé quand `APP_ENV=production` (registre).
 * Idempotent : la même `idempotencyKey` renvoie le même certificat.
 */
export class FakeFneProvider implements FneProvider {
  private failuresLeft: number;
  private readonly issued = new Map<string, FneCertifyResult>();
  calls = 0;

  constructor(private readonly options: FakeFneOptions = {}) {
    this.failuresLeft = options.failTimes ?? 0;
  }

  async certify(invoice: FneInvoicePayload): Promise<FneCertifyResult> {
    this.calls++;
    const existing = this.issued.get(invoice.idempotencyKey);
    if (existing) return existing;
    if (this.options.rejectWith) {
      throw new FneProviderError("rejected", this.options.rejectWith);
    }
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new FneProviderError(
        "transient",
        "Simulateur FNE : service momentanément indisponible.",
      );
    }
    const fneNumber = `SIM-${invoice.number}`;
    const result: FneCertifyResult = {
      fneNumber,
      qrCode: `https://fne.simulateur.atelieros.local/verification/${encodeURIComponent(fneNumber)}`,
      signedAt: this.options.signedAt?.() ?? invoice.issuedAt,
      raw: { simulator: true, documentType: invoice.documentType, total: invoice.totals.total },
    };
    this.issued.set(invoice.idempotencyKey, result);
    return result;
  }

  async healthCheck() {
    return {
      ok: true,
      detail: "Simulateur FNE : aucune certification réelle n'est envoyée à la DGI.",
    };
  }
}
