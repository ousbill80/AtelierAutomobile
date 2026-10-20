import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// M14 RG-M14-06 — portail client : jamais indexé, aucun référent transmis (le jeton est dans l'URL).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
