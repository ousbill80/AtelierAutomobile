import fr from "../../../../../messages/fr.json";
import { portalLabels } from "../../_components/labels";
import type { Metadata } from "next";
import { InvoicePortalView } from "./invoice-portal-view";

// M14 §4.3 — page facture publique : pas d'indexation, pas de référent transmis (RG-M14-06).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvoicePortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <InvoicePortalView
      token={token}
      labels={portalLabels}
      messages={{ invoicePortal: fr.invoicePortal }}
    />
  );
}
