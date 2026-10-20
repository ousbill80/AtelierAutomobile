// M15 RG-M15-20 — quota mensuel de messages automatiques (relances). À 80 % : notification aux
// OWNER ; à 100 % : les relances automatiques passent en NEEDS_APPROVAL (jamais de perte
// silencieuse). Les relances approuvées à la main, les messages manuels et transactionnels ne
// sont jamais bloqués ni comptés.
import { crossedWarningThreshold, usageLevel, usagePeriod } from "@atelieros/core";
import { db, getMonthlyUsage, incrementMonthlyUsage, loadOrgPlan } from "@atelieros/db";

export interface AutoMessageQuotaState {
  reached: boolean;
  limit: number | null;
  used: number;
  planTier: string;
}

export async function autoMessageQuotaState(
  organizationId: string,
  now: Date,
): Promise<AutoMessageQuotaState> {
  const { plan, timezone } = await loadOrgPlan(organizationId);
  const limit = plan.quotas.autoMessagesPerMonth;
  const used = await getMonthlyUsage(organizationId, "auto_messages", usagePeriod(now, timezone));
  return { reached: usageLevel(used, limit) === "REACHED", limit, used, planTier: plan.tier };
}

async function notifyOwners(
  organizationId: string,
  input: { type: string; title: string; body: string; severity: string; dedupeKey: string },
) {
  const tx = db.forTenant({ organizationId });
  const owners = await tx.membership.findMany({
    where: { role: "OWNER", isActive: true },
    select: { id: true },
  });
  for (const owner of owners) {
    const exists = await tx.notification.findFirst({
      where: { membershipId: owner.id, dedupeKey: input.dedupeKey },
      select: { id: true },
    });
    if (exists) continue;
    await tx.notification.create({
      data: { organizationId, membershipId: owner.id, link: "/parametres/abonnement", ...input },
    });
  }
}

/** Compte un message automatique créé ; notifie au passage des 80 % puis des 100 %. */
export async function recordAutoMessage(organizationId: string, now: Date): Promise<void> {
  const { plan, timezone } = await loadOrgPlan(organizationId);
  const period = usagePeriod(now, timezone);
  const { before, after } = await incrementMonthlyUsage(organizationId, "auto_messages", period);
  const limit = plan.quotas.autoMessagesPerMonth;
  if (crossedWarningThreshold(limit, before, after)) {
    await notifyOwners(organizationId, {
      type: "plan.limit_warning",
      title: "80 % du quota de relances automatiques atteint",
      body: `${after} messages automatiques envoyés ce mois sur ${limit} inclus dans l'offre ${plan.tier}.`,
      severity: "warning",
      dedupeKey: `plan.auto_messages.80:${period}`,
    });
  }
  if (limit !== null && before < limit && after >= limit) {
    await notifyOwners(organizationId, {
      type: "plan.limit_reached",
      title: "Quota de relances automatiques atteint",
      body: `Les prochaines relances automatiques attendront votre validation jusqu'à la fin du mois (offre ${plan.tier} : ${limit} messages).`,
      severity: "critical",
      dedupeKey: `plan.auto_messages.100:${period}`,
    });
  }
}
