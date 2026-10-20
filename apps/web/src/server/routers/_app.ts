import { router } from "../trpc";
import { appointmentRouter } from "./appointment";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { deviceRouter } from "./device";
import { importRouter } from "./import";
import { catalogRouter } from "./catalog";
import { channelRouter } from "./channel";
import { contactRouter } from "./contact";
import { customerRouter } from "./customer";
import { alertsRouter, dashboardRouter, digestRouter } from "./dashboard";
import { devOutboxRouter } from "./devOutbox";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { onboardingRouter } from "./onboarding";
import { collectionsRouter } from "./collections";
import { messagingRouter } from "./messaging";
import { optOutRouter } from "./optOut";
import { holidayRouter } from "./holiday";
import { numberingRouter } from "./numbering";
import { orgRouter } from "./org";
import { paymentRouter } from "./payment";
import { invoiceRouter } from "./invoice";
import { fneRouter } from "./fne";
import { cashRouter, refundRouter } from "./cash";
import { accountingRouter } from "./accounting";
import { planningRouter, planningSettingsRouter, resourceBlockRouter } from "./planning";
import { portalAppointmentRouter } from "./portal";
import { quickReplyRouter } from "./quickReply";
import { inspectionRouter, inspectionTemplateRouter } from "./inspection";
import { portalRepairOrderRouter } from "./portalRepairOrder";
import { portalQuoteRouter } from "./portalQuote";
import { quoteRouter } from "./quote";
import { quoteLineRouter } from "./quoteLine";
import { laborOperationRouter } from "./laborOperation";
import { repairOrderRouter } from "./repairOrder";
import { repairOrderLineRouter } from "./repairOrderLine";
import { reminderRulesRouter } from "./reminderRules";
import { remindersRouter } from "./reminders";
import { reminderSettingsRouter } from "./reminderSettings";
import { roleRouter } from "./role";
import { searchRouter } from "./search";
import { segmentRouter } from "./segment";
import { sessionRouter } from "./session";
import { settingsRouter } from "./settings";
import { siteRouter } from "./site";
import { templateRouter } from "./template";
import { vehicleRouter } from "./vehicle";
import { productRouter } from "./product";
import { purchaseOrderRouter } from "./purchaseOrder";
import { stockRouter } from "./stock";
import { stockCountRouter } from "./stockCount";
import { stockTransferRouter } from "./stockTransfer";
import { supplierRouter } from "./supplier";
import { partRequestRouter } from "./partRequest";
import { techRouter } from "./tech";
import { workshopRouter } from "./workshop";

export const appRouter = router({
  invoice: invoiceRouter,
  fne: fneRouter,
  cash: cashRouter,
  refund: refundRouter,
  accounting: accountingRouter,
  auth: authRouter,
  me: meRouter,
  session: sessionRouter,
  org: orgRouter,
  site: siteRouter,
  holiday: holidayRouter,
  numbering: numberingRouter,
  settings: settingsRouter,
  member: memberRouter,
  invitation: invitationRouter,
  role: roleRouter,
  device: deviceRouter,
  audit: auditRouter,
  onboarding: onboardingRouter,
  import: importRouter,
  customer: customerRouter,
  vehicle: vehicleRouter,
  contact: contactRouter,
  catalog: catalogRouter,
  segment: segmentRouter,
  search: searchRouter,
  messaging: messagingRouter,
  template: templateRouter,
  channel: channelRouter,
  optOut: optOutRouter,
  quickReply: quickReplyRouter,
  devOutbox: devOutboxRouter,
  reminders: remindersRouter,
  reminderRules: reminderRulesRouter,
  reminderSettings: reminderSettingsRouter,
  collections: collectionsRouter,
  payment: paymentRouter,
  dashboard: dashboardRouter,
  alerts: alertsRouter,
  digest: digestRouter,
  // M07 — stock, pièces, fournisseurs, achats
  product: productRouter,
  stock: stockRouter,
  stockCount: stockCountRouter,
  stockTransfer: stockTransferRouter,
  supplier: supplierRouter,
  purchaseOrder: purchaseOrderRouter,
  appointment: appointmentRouter,
  planning: planningRouter,
  resourceBlock: resourceBlockRouter,
  planningSettings: planningSettingsRouter,
  repairOrder: repairOrderRouter,
  repairOrderLine: repairOrderLineRouter,
  inspection: inspectionRouter,
  inspectionTemplate: inspectionTemplateRouter,
  quote: quoteRouter,
  quoteLine: quoteLineRouter,
  laborOperation: laborOperationRouter,
  // M06 — atelier, tablette mécanicien, demandes de pièces
  workshop: workshopRouter,
  tech: techRouter,
  partRequest: partRequestRouter,
  portal: router({
    appointment: portalAppointmentRouter,
    repairOrder: portalRepairOrderRouter,
    quote: portalQuoteRouter,
  }),
});

export type AppRouter = typeof appRouter;
