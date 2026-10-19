import { router } from "../trpc";
import { authRouter } from "./auth";
import { meRouter } from "./me";
import { orgRouter } from "./org";
import { sessionRouter } from "./session";
import { siteRouter } from "./site";

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  session: sessionRouter,
  org: orgRouter,
  site: siteRouter,
});

export type AppRouter = typeof appRouter;
