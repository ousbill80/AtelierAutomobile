import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

export type TreasuryJournalInput = Omit<
  inferRouterInputs<AppRouter>["treasury"]["journal"],
  "cursor" | "limit"
>;
