import { randomBytes } from "node:crypto";
import type { Channel } from "@atelieros/core";
import { db } from "@atelieros/db";
import { messagingEnqueue } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Propriétaire",
  MANAGER: "Gérant",
  ADVISOR: "Réceptionniste",
  MECHANIC: "Mécanicien",
  STOREKEEPER: "Magasinier",
  CASHIER: "Caissier",
  ACCOUNTANT: "Comptable",
};

function appBaseUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Met l'invitation dans la file d'envoi du canal actif (Resend, SMTP, SMS, WhatsApp).
 * Sans canal actif, rien n'est mis en file : l'invitation reste enregistrée.
 */
export async function deliverInvitation(input: {
  organizationId: string;
  invitationId: string;
  channel: Channel;
  to: string;
  recipientName: string;
  organizationName: string;
  role: string;
  token: string;
  kind: "created" | "resent";
}): Promise<{ delivered: boolean; reason?: "channel" | "queue" }> {
  const url = `${appBaseUrl()}/invitation/${input.token}`;
  const roleLabel = ROLE_LABEL[input.role] ?? input.role;
  const intro = input.kind === "resent" ? "Rappel : vous êtes invité(e)" : "Vous êtes invité(e)";
  const body = `<p>${escapeHtml(intro)} à rejoindre <strong>${escapeHtml(input.organizationName)}</strong> sur AtelierOS, en tant que ${escapeHtml(roleLabel)}.</p><p><a href="${escapeHtml(url)}">Accepter l'invitation</a></p>`;
  const subject =
    input.kind === "resent"
      ? `Rappel : invitation à rejoindre ${input.organizationName}`
      : `Invitation à rejoindre ${input.organizationName}`;
  const idempotencyKey =
    input.kind === "created"
      ? `invitation:${input.invitationId}:created`
      : `invitation:${input.invitationId}:resent:${randomBytes(4).toString("hex")}`;

  const tenantDb = db.forTenant({ organizationId: input.organizationId });
  const result = await tenantDb.transaction((tx) =>
    messagingEnqueue(tx, input.organizationId, {
      idempotencyKey,
      kind: "transactional",
      to:
        input.channel === "EMAIL"
          ? { email: input.to, name: input.recipientName }
          : { phone: input.to, whatsapp: input.to, name: input.recipientName },
      channels: [input.channel],
      bodyOverride: body,
      subjectOverride: subject,
    }),
  );
  if (!("message" in result)) return { delivered: false, reason: "channel" };
  try {
    await enqueueMessageSendJob(result.message.id);
    return { delivered: true };
  } catch {
    return { delivered: false, reason: "queue" };
  }
}
