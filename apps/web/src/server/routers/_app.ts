import { router } from "../trpc";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { catalogRouter } from "./catalog";
import { contactRouter } from "./contact";
import { customerRouter } from "./customer";
import { deviceRouter } from "./device";
import { importRouter } from "./import";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { onboardingRouter } from "./onboarding";
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
  device: deviceRouter,
  audit: auditRouter,
  onboarding: onboardingRouter,
  import: importRouter,
  customer: customerRouter,
  vehicle: vehicleRouter,
  contact: contactRouter,
  segment: segmentRouter,
  catalog: catalogRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
