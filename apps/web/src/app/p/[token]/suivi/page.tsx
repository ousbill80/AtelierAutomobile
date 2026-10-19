import type { Metadata } from "next";
import { TrackingView } from "./tracking-view";

export const metadata: Metadata = { robots: { index: false } };

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TrackingView token={token} />;
}
