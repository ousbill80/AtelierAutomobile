// Contexte de rendu pour l'aperçu d'une relance unique (`reminders.preview`). Réutilise les
// fragments purs de `core/reminders/context` ; la version groupée (plusieurs véhicules/
// relances combinées) vit côté `apps/worker` (`reminders.dispatch`), qui seul en a besoin.
import { clientNamespace, formatFCFA, garageNamespace, vehicleNamespace } from "@atelieros/core";
import { adminDb, type db } from "@atelieros/db";

type TenantDb = ReturnType<typeof db.forTenant>;

export async function buildPreviewContext(
  tenantDb: TenantDb,
  organizationId: string,
  reminder: {
    type: string;
    customerId: string;
    vehicleId: string | null;
    invoiceId: string | null;
    quoteId: string | null;
    appointmentId: string | null;
  },
): Promise<Record<string, unknown>> {
  const [org, customer, vehicle] = await Promise.all([
    adminDb.organization.findUnique({ where: { id: organizationId } }),
    tenantDb.customer.findFirst({ where: { id: reminder.customerId } }),
    reminder.vehicleId ? tenantDb.vehicle.findFirst({ where: { id: reminder.vehicleId } }) : null,
  ]);

  const base: Record<string, unknown> = {
    garage: garageNamespace(org ?? {}),
    client: customer ? clientNamespace(customer) : { salutation: "", nomComplet: "" },
    vehicule: vehicleNamespace(vehicle),
    lien: { rdv: "", devis: "", facture: "", paiement: "", avis: "" },
  };

  if (reminder.type === "INSPECTION" && vehicle?.inspectionExpiryDate) {
    const days = Math.round((vehicle.inspectionExpiryDate.getTime() - Date.now()) / 86_400_000);
    base.vt = {
      dateExpiration: vehicle.inspectionExpiryDate.toISOString().slice(0, 10),
      joursRestants: String(days),
    };
  }
  if (reminder.type === "SERVICE" && vehicle?.nextServiceDueDate) {
    base.revision = {
      dateEcheance: vehicle.nextServiceDueDate.toISOString().slice(0, 10),
      kmEcheance:
        vehicle.nextServiceDueMileage != null ? `${vehicle.nextServiceDueMileage} km` : "",
    };
  }
  if (reminder.type === "RECEIVABLE") {
    if (reminder.invoiceId) {
      const invoice = await tenantDb.invoice.findFirst({ where: { id: reminder.invoiceId } });
      if (invoice) {
        base.facture = {
          numero: invoice.number,
          echeance: invoice.dueDate?.toISOString().slice(0, 10) ?? "",
          solde: formatFCFA(invoice.balance),
        };
      }
    } else {
      const [kase, invoices] = await Promise.all([
        tenantDb.collectionCase.findFirst({ where: { customerId: reminder.customerId } }),
        tenantDb.invoice.findMany({
          where: {
            customerId: reminder.customerId,
            status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
          },
        }),
      ]);
      const totalDue = invoices.reduce((sum, i) => sum + i.balance, 0);
      const maxDelay = Math.max(
        0,
        ...invoices.map((i) =>
          i.dueDate ? Math.round((Date.now() - i.dueDate.getTime()) / 86_400_000) : 0,
        ),
      );
      base.client = {
        ...(base.client as Record<string, unknown>),
        soldeEnRetard: formatFCFA(kase?.totalDue ?? totalDue),
        joursRetardMax: String(maxDelay),
      };
      base.factures = {
        resume: `${invoices.length} facture(s), ${formatFCFA(totalDue)}`,
        detail: invoices.map((i) => `${i.number} : ${formatFCFA(i.balance)}`).join(" ; "),
      };
    }
  }
  if (reminder.type === "QUOTE_FOLLOWUP" && reminder.quoteId) {
    const quote = await tenantDb.quote.findFirst({ where: { id: reminder.quoteId } });
    if (quote) {
      base.devis = {
        numero: quote.number,
        montant: formatFCFA(quote.total),
        validite: quote.validUntil.toISOString().slice(0, 10),
      };
    }
  }
  if (reminder.type === "APPOINTMENT" && reminder.appointmentId) {
    const appointment = await tenantDb.appointment.findFirst({
      where: { id: reminder.appointmentId },
    });
    if (appointment) {
      base.rdv = {
        date: appointment.startsAt.toISOString().slice(0, 10),
        heure: appointment.startsAt.toISOString().slice(11, 16),
      };
    }
  }
  if (reminder.type === "INSURANCE_EXPIRY" && vehicle?.insuranceExpiryDate) {
    base.assurance = { dateExpiration: vehicle.insuranceExpiryDate.toISOString().slice(0, 10) };
  }

  return base;
}
