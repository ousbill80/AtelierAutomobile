import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/trpc/server";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
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

  if (me.activeOrganization?.onboardingCompletedAt) {
    redirect("/");
  }

  return <div className="onboarding-wrap">{children}</div>;
}
