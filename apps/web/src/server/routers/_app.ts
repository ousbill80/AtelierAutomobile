import { router } from "../trpc";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { deviceRouter } from "./device";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { orgRouter } from "./org";
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
});

export type AppRouter = typeof appRouter;
