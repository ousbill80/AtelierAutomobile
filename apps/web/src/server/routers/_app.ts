import { router } from "../trpc";
import { authRouter } from "./auth";
import { catalogRouter } from "./catalog";
import { channelRouter } from "./channel";
import { contactRouter } from "./contact";
import { customerRouter } from "./customer";
import { devOutboxRouter } from "./devOutbox";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { messagingRouter } from "./messaging";
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
import { siteRouter } from "./site";
import { templateRouter } from "./template";
import { vehicleRouter } from "./vehicle";

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  session: sessionRouter,
  org: orgRouter,
  site: siteRouter,
  member: memberRouter,
  invitation: invitationRouter,
  role: roleRouter,
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
});

export type AppRouter = typeof appRouter;
