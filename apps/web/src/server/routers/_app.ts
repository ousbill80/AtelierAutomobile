import { router } from "../trpc";
import { authRouter } from "./auth";
import { meRouter } from "./me";
import { sessionRouter } from "./session";

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  session: sessionRouter,
});

export type AppRouter = typeof appRouter;
