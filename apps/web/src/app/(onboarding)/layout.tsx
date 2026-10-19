import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/trpc/server";
import { t } from "@/i18n/t";

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

  return (
    <div className="onboarding-wrap">
      <header className="onboarding-brand">
        <span className="mark" aria-hidden="true">
          A
        </span>
        <span className="name">{t("auth.brand")}</span>
      </header>
      {children}
    </div>
  );
}
