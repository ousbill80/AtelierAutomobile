import { router } from "../trpc";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { channelRouter } from "./channel";
import { devOutboxRouter } from "./devOutbox";
import { deviceRouter } from "./device";
import { importRouter } from "./import";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { messagingRouter } from "./messaging";
import { onboardingRouter } from "./onboarding";
import { optOutRouter } from "./optOut";
import { orgRouter } from "./org";
import { quickReplyRouter } from "./quickReply";
import { reminderRulesRouter } from "./reminderRules";
import { remindersRouter } from "./reminders";
import { reminderSettingsRouter } from "./reminderSettings";
import { roleRouter } from "./role";
import { sessionRouter } from "./session";
import { siteRouter } from "./site";
import { templateRouter } from "./template";

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  session: sessionRouter,
  org: orgRouter,
  site: siteRouter,
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
});

export type AppRouter = typeof appRouter;
