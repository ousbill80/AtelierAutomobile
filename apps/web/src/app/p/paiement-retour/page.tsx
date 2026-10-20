// Page de retour générique après un paiement par lien envoyé par le garage (sans jeton portail) :
// le paiement n'est jamais déclaré « payé » ici, seul le webhook confirmé fait foi (RG-M14-15).
import type { Metadata } from "next";
import { t } from "@/i18n/t";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PaymentReturnPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 p-6 text-center text-base">
      <h1 className="text-xl font-semibold">{t("invoicePortal.returnTitle")}</h1>
      <p>{t("invoicePortal.returnText")}</p>
    </main>
  );
}
