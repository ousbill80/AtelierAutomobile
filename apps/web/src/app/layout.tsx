import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TrpcProvider } from "@/trpc/Provider";
import { fontClassName } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "AtelierOS",
  description:
    "Gestion d'atelier automobile — rendez-vous, ordres de réparation, devis, facturation et relances automatiques.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr" className={`h-full antialiased ${fontClassName}`}>
      <body className="min-h-full flex flex-col">
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
