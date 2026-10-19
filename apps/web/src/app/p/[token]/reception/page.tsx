import type { Metadata } from "next";
import { SignView } from "./sign-view";

export const metadata: Metadata = { robots: { index: false } };

export default async function RemoteSignaturePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SignView token={token} />;
}
