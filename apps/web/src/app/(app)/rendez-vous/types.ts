import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type PlanningList = RouterOutputs["appointment"]["list"];
export type PlanningAppointment = PlanningList["appointments"][number];
export type CapacityRow = RouterOutputs["planning"]["capacity"][number];
