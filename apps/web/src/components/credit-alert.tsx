"use client";

// M09 §7.3 — alerte crédit partagée (RG-M09-10) : fiche client aujourd'hui, création d'OR
// (M04), devis (M05) et facture à crédit (M08) quand ces écrans existeront. Le texte vient
// du serveur (`collections.creditCheck` → `core/receivables/creditCheck`).
import { t } from "@/app/(app)/creances/i18n";
import { trpc } from "@/trpc/react";

export interface CreditAlertProps {
  customerId: string;
  /** Montant estimé du document en cours (OR, devis, facture), ajouté à l'exposition. */
  additionalAmount?: number;
}

export function CreditAlert({ customerId, additionalAmount }: CreditAlertProps) {
  const { data } = trpc.collections.creditCheck.useQuery(
    { customerId, additionalAmount },
    { retry: false },
  );
  // Sans permission `receivable:read` ou client sans retard : rien à afficher.
  if (!data || data.level === "OK" || !data.message) return null;
  const blocking = data.level === "BLOCK";
  return (
    <div
      role={blocking ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
        blocking
          ? "border-status-bad bg-status-bad/10 text-status-bad"
          : "border-status-warn bg-status-warn/10 text-status-warn"
      }`}
    >
      <span aria-hidden className="text-lg leading-none">
        {blocking ? "⛔" : "⚠"}
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">
          {blocking ? t("creditAlert.blockTitle") : t("creditAlert.warnTitle")}
        </p>
        <p className="text-fg">{data.message}</p>
      </div>
    </div>
  );
}
