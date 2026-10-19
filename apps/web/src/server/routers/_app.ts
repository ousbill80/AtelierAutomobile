import { router } from "../trpc";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { deviceRouter } from "./device";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { onboardingRouter } from "./onboarding";
import { orgRouter } from "./org";
import { reminderRulesRouter } from "./reminderRules";
import { reminderSettingsRouter } from "./reminderSettings";
import { remindersRouter } from "./reminders";
import { roleRouter } from "./role";
import { sessionRouter } from "./session";
import { siteRouter } from "./site";

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
  reminders: remindersRouter,
  reminderRules: reminderRulesRouter,
  reminderSettings: reminderSettingsRouter,
});

export type AppRouter = typeof appRouter;
