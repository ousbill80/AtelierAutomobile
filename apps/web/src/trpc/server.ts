import { headers } from "next/headers";
import { createContext } from "@/server/context";
import { appRouter } from "@/server/routers/_app";
import { createCallerFactory } from "@/server/trpc";

const createCaller = createCallerFactory(appRouter);

/** Appelle les routeurs tRPC directement depuis un Server Component (lecture seule). */
export async function serverCaller() {
  const headersList = await headers();
  const req = new Request("http://localhost/api/trpc", { headers: headersList });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return createCaller(ctx);
}
