import type { Metadata } from "next";
import { QuotePortal } from "./quote-portal";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function QuotePortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <QuotePortal token={token} />;
}
