import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/trpc/server";

// M06 §7 — layout plein écran de la tablette (PWA), sans menu latéral.
export const metadata: Metadata = {
  title: "AtelierOS — Tablette",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#0f172a" };

export default async function TechLayout({ children }: { children: ReactNode }) {
  const caller = await serverCaller();
  try {
    await caller.me.get();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "UNAUTHORIZED") redirect("/connexion");
    throw err;
  }
  return <main className="min-h-full bg-bg">{children}</main>;
}
