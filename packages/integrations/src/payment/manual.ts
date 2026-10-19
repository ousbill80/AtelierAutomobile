import { DomainError } from "@atelieros/core";
import type {
  CreatePaymentLinkInput,
  CreatePaymentLinkResult,
  PaymentEvent,
  PaymentProvider,
  PaymentStatus,
} from "./provider";

export interface ManualPaymentRecord {
  providerRef: string;
  status: PaymentStatus;
}

/** Statuts des paiements créés par {@link ManualPaymentProvider}, mis à jour par un caissier. */
export interface ManualPaymentLedger {
  save(record: ManualPaymentRecord): void;
  get(providerRef: string): ManualPaymentRecord | undefined;
}

export function createInMemoryManualPaymentLedger(): ManualPaymentLedger {
  const records = new Map<string, ManualPaymentRecord>();
  return {
    save(record) {
      records.set(record.providerRef, record);
    },
    get(providerRef) {
      return records.get(providerRef);
    },
  };
}

/**
 * Fournisseur de paiement "manual" : aucun opérateur mobile money réel. Le lien renvoyé
 * pointe vers l'écran de confirmation manuelle de l'app (M08), où le caissier marque la
 * facture payée après avoir reçu l'argent (espèces, virement, ou Wave/OM confirmé de visu).
 */
export class ManualPaymentProvider implements PaymentProvider {
  constructor(
    private readonly appUrl: string,
    private readonly ledger: ManualPaymentLedger,
  ) {}

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult> {
    const providerRef = `manual_${input.invoiceId}`;
    this.ledger.save({ providerRef, status: "PENDING" });
    return { url: `${this.appUrl}/paiement-manuel/${providerRef}`, providerRef };
  }

  async parseWebhook(_req: Request): Promise<PaymentEvent> {
    throw new DomainError(
      "payment.manual_no_webhook",
      "Le fournisseur de paiement manuel ne reçoit pas de webhook : la confirmation se fait depuis l'écran de caisse.",
    );
  }

  async getStatus(providerRef: string): Promise<PaymentStatus> {
    return this.ledger.get(providerRef)?.status ?? "PENDING";
  }
}
