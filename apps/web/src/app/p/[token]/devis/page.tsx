import type { Metadata } from "next";
import { QuotePortalView } from "./quote-portal-view";

// RG-M05-09 / RG-M14-06 : pas d'indexation, pas de référent transmis.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function QuotePortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <QuotePortalView token={token} />;
}
