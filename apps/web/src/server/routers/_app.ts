import { router } from "../trpc";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { catalogRouter } from "./catalog";
import { channelRouter } from "./channel";
import { contactRouter } from "./contact";
import { customerRouter } from "./customer";
import { devOutboxRouter } from "./devOutbox";
import { deviceRouter } from "./device";
import { holidayRouter } from "./holiday";
import { importRouter } from "./import";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { messagingRouter } from "./messaging";
import { numberingRouter } from "./numbering";
import { onboardingRouter } from "./onboarding";
import { optOutRouter } from "./optOut";
import { orgRouter } from "./org";
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
  messaging: messagingRouter,
  template: templateRouter,
  channel: channelRouter,
  optOut: optOutRouter,
  quickReply: quickReplyRouter,
  devOutbox: devOutboxRouter,
  reminders: remindersRouter,
  reminderRules: reminderRulesRouter,
  reminderSettings: reminderSettingsRouter,
  customer: customerRouter,
  vehicle: vehicleRouter,
  contact: contactRouter,
  segment: segmentRouter,
  catalog: catalogRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
