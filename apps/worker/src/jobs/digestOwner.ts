// M12 §9 — `digest.owner` (toutes les 15 min) : résumé quotidien gérant (US-M12-08,
// RG-M12-30). Pour chaque organisation dont l'heure locale a atteint `settings.digest.time`,
// envoie à chaque destinataire (OWNER actifs par défaut) un message M11 `kind = DIGEST`,
// une seule fois par jour (`idempotencyKey = digest:{membershipId}:{date}`). Message interne :
// pas soumis à `OptOut`. Chiffres filtrés par `Membership.siteIds`.
import { digestDedupeKey, isDigestDue, localDay, type Channel } from "@atelieros/core";
import { adminDb, buildDigestForMembership, db } from "@atelieros/db";
import { DEFAULT_DIGEST_SETTINGS, digestSettingsSchema } from "@atelieros/validators";
import { logger } from "../logger";
import { enqueueMessageSendJob } from "../queues/messages";

interface Recipient {
  membershipId: string;
  siteIds: string[];
  phone: string | null;
  email: string | null;
}

function addressFor(channel: Channel, recipient: Recipient): string | null {
  return channel === "EMAIL" ? recipient.email : recipient.phone;
}

export async function sendOrganizationDigest(organizationId: string, now: Date): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, timezone: true, operatingMode: true, settings: true },
  });
  const raw = (org.settings as { digest?: unknown } | null)?.digest ?? {};
  const settings = digestSettingsSchema.catch(DEFAULT_DIGEST_SETTINGS).parse(raw);
  if (!settings.enabled || !isDigestDue(now, org.timezone, settings.time)) return 0;

  const tenantDb = db.forTenant({ organizationId });
  const today = localDay(now, org.timezone);
  const memberships = await tenantDb.membership.findMany({
    where: {
      isActive: true,
      ...(settings.recipients.length > 0 ? { id: { in: settings.recipients } } : { role: "OWNER" }),
    },
    select: { id: true, siteIds: true, user: { select: { phone: true, email: true } } },
  });
  const configs = await tenantDb.channelConfig.findMany({
    where: { isActive: true },
    orderBy: { priority: "asc" },
    select: { channel: true, provider: true },
  });
  const providerByChannel = new Map<string, string>();
  for (const c of configs)
    if (!providerByChannel.has(c.channel)) providerByChannel.set(c.channel, c.provider);

  let sent = 0;
  for (const m of memberships) {
    const recipient: Recipient = {
      membershipId: m.id,
      siteIds: m.siteIds,
      phone: m.user.phone,
      email: m.user.email,
    };
    // Canal configuré, sinon repli email (RG-M12-30 : « si WhatsApp échoue → email »).
    const channel = ([settings.channel, "EMAIL"] as Channel[]).find(
      (c) => providerByChannel.has(c) && addressFor(c, recipient),
    );
    if (!channel) {
      logger.warn(
        { organizationId, membershipId: m.id },
        "digest.owner : aucun canal ni adresse, ignoré",
      );
      continue;
    }
    const idempotencyKey = digestDedupeKey(m.id, today);
    const existing = await tenantDb.message.findFirst({ where: { idempotencyKey } });
    if (existing) continue;

    const body = await buildDigestForMembership(
      tenantDb,
      org,
      m,
      now,
      `${process.env.APP_URL ?? "http://localhost:3000"}/tableau-de-bord`,
    );
    try {
      const message = await tenantDb.message.create({
        data: {
          organizationId,
          direction: "OUTBOUND",
          channel,
          to: addressFor(channel, recipient)!,
          subject: channel === "EMAIL" ? `Résumé du jour — ${org.name}` : undefined,
          body,
          status: "QUEUED",
          provider: providerByChannel.get(channel)!,
          kind: "DIGEST",
          idempotencyKey,
        },
      });
      await enqueueMessageSendJob(message.id);
      sent += 1;
    } catch (error) {
      // Contrainte unique (organizationId, idempotencyKey, channel) : passage concurrent.
      const isUniqueViolation =
        typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
      if (!isUniqueViolation) throw error;
    }
  }
  return sent;
}

export async function processDigestOwnerJob(now = new Date()): Promise<void> {
  const organizations = await adminDb.organization.findMany({ select: { id: true } });
  for (const { id: organizationId } of organizations) {
    try {
      await sendOrganizationDigest(organizationId, now);
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "digest.owner : échec sur une organisation, passage à la suivante",
      );
    }
  }
}
