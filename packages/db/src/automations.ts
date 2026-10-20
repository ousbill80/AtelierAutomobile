// M17 RG-M17-23/24 — contexte des automatisations, partagé par apps/worker (exécution,
// `automations.dispatch`) et apps/web (test à blanc `automations.test`) : payload d'événement
// enrichi (OR, client, facture, site…) sur lequel portent les conditions, contexte de rendu des
// modèles M11 et aperçu des actions. Aucune écriture ici.
import {
  clientNamespace,
  formatFCFA,
  garageNamespace,
  interpolateAutomationText,
  renderTemplate,
  vehicleNamespace,
  type AutomationAction,
} from "@atelieros/core";
import type { db } from "./tenant";

type TenantDb = ReturnType<typeof db.forTenant>;

export interface AutomationContext {
  event: Record<string, unknown>;
  customer?: {
    id: string;
    type: string;
    displayName: string;
    civility: "M" | "MME" | "MLLE" | null;
    lastName: string | null;
    tags: string[];
    phone: string | null;
    phone2: string | null;
    whatsappPhone: string | null;
    email: string | null;
    remindersConsent: boolean;
    doNotRemind: boolean;
    optedOutAt: Date | null;
  };
  repairOrder?: {
    id: string;
    number: string;
    status: string;
    siteId: string;
    totalEstimate: number;
    advisorId: string | null;
  };
  invoice?: { id: string; number: string | null; total: number; balance: number; status: string };
  quote?: { id: string; number: string; status: string };
  appointment?: { id: string; status: string; startsAt: Date };
  payment?: { id: string; amount: number; method: string };
  vehicle?: { id: string; make: string; model: string; plate: string };
  site?: { id: string; code: string; name: string; phone: string | null };
  /** Lien de paiement actif de la facture concernée (RG-M17-23 `withPaymentLink`). */
  paymentLinkUrl?: string;
}

const str = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** Charge les entités référencées par le payload de l'événement (via `db.forTenant`). */
export async function enrichAutomationContext(
  tenantDb: TenantDb,
  payload: Record<string, unknown>,
  now: Date = new Date(),
): Promise<AutomationContext> {
  const ctx: AutomationContext = { event: payload };
  const repairOrderId = str(payload.repairOrderId);
  const invoiceId = str(payload.invoiceId);
  const quoteId = str(payload.quoteId);
  const appointmentId = str(payload.appointmentId);
  const paymentId = str(payload.paymentId);

  if (repairOrderId) {
    const ro = await tenantDb.repairOrder.findFirst({ where: { id: repairOrderId } });
    if (ro) {
      ctx.repairOrder = {
        id: ro.id,
        number: ro.number,
        status: ro.status,
        siteId: ro.siteId,
        totalEstimate: ro.totalEstimate,
        advisorId: ro.advisorId,
      };
    }
  }
  const invoice = invoiceId
    ? await tenantDb.invoice.findFirst({ where: { id: invoiceId } })
    : repairOrderId
      ? await tenantDb.invoice.findFirst({
          where: { repairOrderId, status: { notIn: ["DRAFT", "VOID"] } },
          orderBy: { createdAt: "desc" },
        })
      : null;
  if (invoice) {
    ctx.invoice = {
      id: invoice.id,
      number: invoice.number,
      total: invoice.total,
      balance: invoice.balance,
      status: invoice.status,
    };
    const link = await tenantDb.paymentLink.findFirst({
      where: { invoiceId: invoice.id, status: "PENDING", closedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    if (link) ctx.paymentLinkUrl = link.url;
  }
  const quote = quoteId ? await tenantDb.quote.findFirst({ where: { id: quoteId } }) : null;
  if (quote) ctx.quote = { id: quote.id, number: quote.number, status: quote.status };
  const appointment = appointmentId
    ? await tenantDb.appointment.findFirst({ where: { id: appointmentId } })
    : null;
  if (appointment) {
    ctx.appointment = {
      id: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt,
    };
  }
  const payment = paymentId ? await tenantDb.payment.findFirst({ where: { id: paymentId } }) : null;
  if (payment) ctx.payment = { id: payment.id, amount: payment.amount, method: payment.method };

  const customerId =
    str(payload.customerId) ?? quote?.customerId ?? appointment?.customerId ?? undefined;
  if (customerId) {
    const c = await tenantDb.customer.findFirst({ where: { id: customerId } });
    if (c) {
      ctx.customer = {
        id: c.id,
        type: c.type,
        displayName: c.displayName,
        civility: c.civility,
        lastName: c.lastName,
        tags: c.tags,
        phone: c.phone,
        phone2: c.phone2,
        whatsappPhone: c.whatsappPhone,
        email: c.email,
        remindersConsent: c.remindersConsent,
        doNotRemind: c.doNotRemind,
        optedOutAt: c.optedOutAt,
      };
    }
  }
  const vehicleId =
    str(payload.vehicleId) ?? quote?.vehicleId ?? appointment?.vehicleId ?? undefined;
  if (vehicleId) {
    const v = await tenantDb.vehicle.findFirst({ where: { id: vehicleId } });
    if (v) ctx.vehicle = { id: v.id, make: v.make, model: v.model, plate: v.plate };
  }
  const siteId =
    ctx.repairOrder?.siteId ?? invoice?.siteId ?? quote?.siteId ?? appointment?.siteId ?? null;
  if (siteId) {
    const site = await tenantDb.site.findFirst({ where: { id: siteId } });
    if (site) ctx.site = { id: site.id, code: site.code, name: site.name, phone: site.phone };
  }
  return ctx;
}

export interface GarageLike {
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
}

/** Contexte de rendu des modèles M11 (`{{client.salutation}}`, `{{lien.paiement}}`…). */
export function automationMessageContext(
  ctx: AutomationContext,
  garage: GarageLike,
  options: { paymentLink?: string } = {},
): Record<string, unknown> {
  const balance = ctx.invoice?.balance ?? ctx.repairOrder?.totalEstimate;
  return {
    garage: garageNamespace({ ...garage, phone: ctx.site?.phone ?? garage.phone }),
    client: ctx.customer ? clientNamespace(ctx.customer) : { salutation: "", nomComplet: "" },
    vehicule: vehicleNamespace(ctx.vehicle ?? null),
    facture: {
      numero: ctx.invoice?.number ?? "",
      solde: balance !== undefined ? formatFCFA(balance) : "",
    },
    or: { numero: ctx.repairOrder?.number ?? "" },
    devis: { numero: ctx.quote?.number ?? "" },
    paiement: { montant: ctx.payment ? formatFCFA(ctx.payment.amount) : "" },
    evenement: { note: String(ctx.event.rating ?? "") },
    lien: {
      paiement: options.paymentLink ?? "",
      rdv: "",
      devis: "",
      facture: "",
      avis: "",
    },
  };
}

/** Adresse d'envoi du client pour un canal (WhatsApp → whatsappPhone ?? phone). */
export function automationRecipientAddress(
  customer: NonNullable<AutomationContext["customer"]>,
  channel: "WHATSAPP" | "SMS" | "EMAIL",
): string | null {
  if (channel === "EMAIL") return customer.email;
  if (channel === "WHATSAPP") return customer.whatsappPhone ?? customer.phone ?? customer.phone2;
  return customer.phone ?? customer.phone2;
}

export interface ActionPreview {
  type: AutomationAction["type"];
  preview: string;
}

/** Aperçu lisible de chaque action (test à blanc, proposition PROPOSE) — aucun envoi. */
export async function previewAutomationActions(
  tenantDb: TenantDb,
  actions: readonly AutomationAction[],
  ctx: AutomationContext,
  garage: GarageLike,
): Promise<ActionPreview[]> {
  const out: ActionPreview[] = [];
  for (const action of actions) {
    switch (action.type) {
      case "send_template": {
        const template = await tenantDb.messageTemplate.findFirst({
          where: { key: action.templateKey, channel: action.channel, isActive: true },
        });
        const to = ctx.customer ? automationRecipientAddress(ctx.customer, action.channel) : null;
        let body: string;
        if (!template) {
          body = `Modèle « ${action.templateKey} » (${action.channel}) introuvable.`;
        } else {
          try {
            body = renderTemplate({
              template: template.body,
              context: automationMessageContext(ctx, garage, {
                paymentLink: action.withPaymentLink
                  ? (ctx.paymentLinkUrl ?? "[lien de paiement]")
                  : undefined,
              }),
              channel: action.channel,
            }).body;
          } catch (error) {
            body = error instanceof Error ? error.message : "Rendu impossible.";
          }
        }
        out.push({ type: action.type, preview: `${action.channel} → ${to ?? "?"} : ${body}` });
        break;
      }
      case "notify_members":
      case "create_task":
        out.push({
          type: action.type,
          preview: `${(action.roles ?? []).join(", ") || "membres choisis"} : ${interpolateAutomationText(
            action.title,
            automationMessageContext(ctx, garage),
          )}`,
        });
        break;
      case "add_customer_tag":
        out.push({ type: action.type, preview: `Tag « ${action.tag} »` });
        break;
      case "assign_conversation":
        out.push({ type: action.type, preview: `Conversation assignée à ${action.membershipId}` });
        break;
      default:
        out.push({ type: action.type, preview: "Action non disponible en v1." });
    }
  }
  return out;
}
