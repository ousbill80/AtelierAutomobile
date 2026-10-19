import { router } from "../trpc";
import { authRouter } from "./auth";
import { deviceRouter } from "./device";
import { holidayRouter } from "./holiday";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { numberingRouter } from "./numbering";
import { orgRouter } from "./org";
import { roleRouter } from "./role";
import { sessionRouter } from "./session";
import { settingsRouter } from "./settings";
import { siteRouter } from "./site";

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
});

export type AppRouter = typeof appRouter;
