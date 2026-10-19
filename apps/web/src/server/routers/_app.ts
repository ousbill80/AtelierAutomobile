import { router } from "../trpc";
import { appointmentRouter } from "./appointment";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { catalogRouter } from "./catalog";
import { contactRouter } from "./contact";
import { customerRouter } from "./customer";
import { deviceRouter } from "./device";
import { holidayRouter } from "./holiday";
import { importRouter } from "./import";
import { invitationRouter } from "./invitation";
import { meRouter } from "./me";
import { memberRouter } from "./member";
import { numberingRouter } from "./numbering";
import { onboardingRouter } from "./onboarding";
import { orgRouter } from "./org";
import { planningRouter } from "./planning";
import { portalRouter } from "./portal";
import { resourceBlockRouter } from "./resourceBlock";
import { roleRouter } from "./role";
import { searchRouter } from "./search";
import { segmentRouter } from "./segment";
import { sessionRouter } from "./session";
import { settingsRouter } from "./settings";
import { siteRouter } from "./site";
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
  segment: segmentRouter,
  catalog: catalogRouter,
  search: searchRouter,
  appointment: appointmentRouter,
  planning: planningRouter,
  resourceBlock: resourceBlockRouter,
  portal: portalRouter,
});

export type AppRouter = typeof appRouter;
