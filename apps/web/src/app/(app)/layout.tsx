import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/trpc/server";
import { AppShellClient } from "./AppShellClient";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const caller = await serverCaller();
  let me;
  try {
    me = await caller.me.get();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "UNAUTHORIZED") {
      redirect("/connexion");
    }
    throw err;
  }

  const onboardingDone = Boolean(me.activeOrganization?.onboardingCompletedAt);
  if (!onboardingDone) {
    redirect("/bienvenue");
  }

  return <AppShellClient me={me}>{children}</AppShellClient>;
}
