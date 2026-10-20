// Simulateur de paiement mobile money (hors production) : page de paiement fictive vers
// laquelle pointe un lien du fournisseur « fake ». « Payer » poste le formulaire au simulateur,
// qui signe un webhook comme un agrégateur puis renvoie le client vers sa page facture.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { defaultSimulatorLedger } from "@atelieros/integrations";
import { t } from "@/i18n/t";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SimulatedPaymentPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  if (process.env.APP_ENV === "production") notFound();
  const { ref } = await params;
  const record = defaultSimulatorLedger().get(ref);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-6 text-base">
      <h1 className="text-xl font-semibold">{t("invoicePortal.simulatorTitle")}</h1>
      <p className="rounded-md bg-surface-2 p-3 text-sm">{t("invoicePortal.simulatorHint")}</p>
      {!record || record.status !== "PENDING" ? (
        <p role="alert" className="text-status-bad">
          {t("invoicePortal.simulatorGone")}
        </p>
      ) : (
        <form method="post" action={`/api/paiement-simule/${ref}`} className="flex flex-col gap-3">
          {record.description && <p className="font-semibold">{record.description}</p>}
          <p className="text-2xl font-semibold">{formatFCFA(record.amount)}</p>
          <button type="submit" name="outcome" value="pay" className="btn btn-primary min-h-12">
            {t("invoicePortal.simulatorPay", { amount: formatFCFA(record.amount) })}
          </button>
          <button type="submit" name="outcome" value="fail" className="btn btn-secondary min-h-11">
            {t("invoicePortal.simulatorFail")}
          </button>
        </form>
      )}
    </main>
  );
}
