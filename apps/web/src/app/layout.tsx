import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { TrpcProvider } from "@/trpc/Provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "AtelierOS",
  description:
    "Gestion d'atelier automobile — rendez-vous, ordres de réparation, devis, facturation et relances automatiques.",
  applicationName: "AtelierOS",
  // PWA : installation sur l'écran d'accueil (iOS lit ces balises, Android le manifeste).
  appleWebApp: { capable: true, title: "AtelierOS", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  // Plein écran sur les téléphones à encoche : les marges de sécurité sont gérées en CSS.
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
