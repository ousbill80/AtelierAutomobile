// RG-M10-11/12 — résolution du destinataire et des canaux disponibles. Partagé par
// `reminders.plan` (canal préliminaire, pour router une relance sans canal vers « À appeler »
// dès sa création, RG-M10-31) et `reminders.dispatch` (résolution faisant foi à l'envoi,
// RG-M10-24 : revérifiée indépendamment, peut différer de celle posée par plan).
import { adminDb, db } from "@atelieros/db";
import {
  buildRecipientKey,
  orderChannelsByPreference,
  resolveAiSettings,
  normalizePhoneCI,
  phoneLineType,
  type Channel,
  type ChannelCandidate,
} from "@atelieros/core";

type TenantDb = ReturnType<typeof db.forTenant>;

export interface RecipientInfo {
  customerId: string;
  recipientKey: string;
  to: { phone?: string | null; whatsapp?: string | null; email?: string | null };
}

export interface RecipientCustomerLike {
  id: string;
  type: string;
  phone: string | null;
  phone2: string | null;
  whatsappPhone: string | null;
  email: string | null;
}

/** RG-M10-11 : INDIVIDUAL → whatsappPhone ?? phone ?? phone2 ?? email ; COMPANY → CustomerContact. */
export async function resolveRecipient(
  tenantDb: TenantDb,
  customer: RecipientCustomerLike,
  reminderType: string,
): Promise<RecipientInfo | null> {
  if (customer.type === "COMPANY") {
    const isReceivable = reminderType === "RECEIVABLE";
    const contact = await tenantDb.customerContact.findFirst({
      where: {
        customerId: customer.id,
        deletedAt: null,
        ...(isReceivable ? { receivesInvoices: true } : { receivesReminders: true }),
      },
      orderBy: { isPrimary: "desc" },
    });
    const phone = contact?.phone ?? contact?.phone2 ?? customer.phone ?? null;
    const email = contact?.email ?? customer.email ?? null;
    if (!phone && !email) return null;
    const recipientKey = phone
      ? buildRecipientKey({ kind: "phone", e164: phone })
      : buildRecipientKey({ kind: "email", address: email! });
    return { customerId: customer.id, recipientKey, to: { phone, whatsapp: phone, email } };
  }

  const whatsapp = customer.whatsappPhone ?? customer.phone;
  const phone = customer.phone ?? customer.phone2;
  const email = customer.email;
  if (!whatsapp && !phone && !email) return null;
  const recipientKey = phone
    ? buildRecipientKey({ kind: "phone", e164: phone })
    : whatsapp
      ? buildRecipientKey({ kind: "phone", e164: whatsapp })
      : buildRecipientKey({ kind: "email", address: email! });
  return { customerId: customer.id, recipientKey, to: { phone, whatsapp, email } };
}

export interface ChannelResolution {
  candidates: ChannelCandidate[];
  providerByChannel: Map<Channel, string>;
}

/**
 * RG-M10-12 : écarte WhatsApp/SMS pour un numéro fixe, une adresse invalide ou un OptOut.
 * M17 RG-M17-16 : le canal préféré du client (choix manuel `preferredChannel`, sinon canal
 * appris `bestChannel` si l'optimisation IA est activée) est essayé en premier ; il reste
 * soumis aux mêmes contrôles, revérifiés au moment de l'envoi (`reminders.dispatch`).
 */
export async function resolveChannelCandidates(
  tenantDb: TenantDb,
  recipient: RecipientInfo,
  ruleChannels: Channel[],
): Promise<ChannelResolution> {
  const customer = await tenantDb.customer.findFirst({ where: { id: recipient.customerId } });
  const org = customer
    ? await adminDb.organization.findUnique({
        where: { id: customer.organizationId },
        select: { settings: true },
      })
    : null;
  const ai = resolveAiSettings(org?.settings);
  const stepChannels = customer
    ? orderChannelsByPreference({
        stepChannels: ruleChannels,
        preferredChannel: customer.preferredChannel,
        bestChannel: customer.bestChannel,
        hasWhatsapp: customer.hasWhatsapp,
        useLearned: ai.enabled && ai.autoTimeOptimization,
      })
    : ruleChannels;
  const configs = await tenantDb.channelConfig.findMany({
    where: { channel: { in: stepChannels } },
  });
  const optOuts = await tenantDb.optOut.findMany({
    where: {
      address: {
        in: [recipient.to.whatsapp, recipient.to.phone, recipient.to.email].filter(
          (a): a is string => !!a,
        ),
      },
    },
  });

  const providerByChannel = new Map<Channel, string>();
  const candidates = stepChannels.map((channel): ChannelCandidate => {
    const address =
      channel === "WHATSAPP"
        ? (recipient.to.whatsapp ?? recipient.to.phone ?? null)
        : channel === "SMS"
          ? (recipient.to.phone ?? null)
          : (recipient.to.email ?? null);
    const isFixedLine =
      channel !== "EMAIL" &&
      !!address &&
      phoneLineType(normalizePhoneCI(address).e164 ?? address) === "FIXED";
    const activeConfig = configs
      .filter((c) => c.channel === channel && c.isActive && c.status !== "ERROR")
      .sort((a, b) => a.priority - b.priority)[0];
    providerByChannel.set(channel, activeConfig?.provider ?? "console");
    return {
      channel,
      address: isFixedLine ? null : address,
      isOptedOut:
        !!address &&
        optOuts.some((o) => o.address === address && (o.channel === null || o.channel === channel)),
      isAddressInvalid:
        channel === "EMAIL" ? !!customer?.emailInvalidAt : !!customer?.phoneInvalidAt,
      isChannelActive: !!activeConfig,
      // Simplification : la fenêtre WhatsApp 24h / modèle Meta approuvé (RG-M11-10) n'est pas
      // revérifiée ici ; déjà couverte côté M11 pour l'envoi manuel.
      hasApprovedTemplate: channel === "WHATSAPP" ? true : undefined,
    };
  });
  return { candidates, providerByChannel };
}
