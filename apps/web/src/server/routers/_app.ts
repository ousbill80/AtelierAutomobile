import { router } from "../trpc";
import { authRouter } from "./auth";
import { catalogRouter } from "./catalog";
import { contactRouter } from "./contact";
import { customerRouter } from "./customer";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { orgRouter } from "./org";
import { roleRouter } from "./role";
import { searchRouter } from "./search";
import { segmentRouter } from "./segment";
import { sessionRouter } from "./session";
import { siteRouter } from "./site";
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
});

export type AppRouter = typeof appRouter;
