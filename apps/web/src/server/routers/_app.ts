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
import { planningRouter, planningSettingsRouter, resourceBlockRouter } from "./planning";
import { portalRouter } from "./portal";
import { quickReplyRouter } from "./quickReply";
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

export const appRouter = router({
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
  appointment: appointmentRouter,
  planning: planningRouter,
  resourceBlock: resourceBlockRouter,
  planningSettings: planningSettingsRouter,
  portal: portalRouter,
});

export type AppRouter = typeof appRouter;
