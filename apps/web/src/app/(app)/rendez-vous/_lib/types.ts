import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type PlanningData = RouterOutputs["appointment"]["list"];
export type PlanningAppointment = PlanningData["appointments"][number];
export type PlanningBay = PlanningData["bays"][number];
export type PlanningMechanic = PlanningData["mechanics"][number];
export type PlanningBlock = PlanningData["blocks"][number];
export type AppointmentDetail = RouterOutputs["appointment"]["get"];
export type SlotsResult = RouterOutputs["planning"]["availableSlots"];
