import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type BoardCard = RouterOutputs["repairOrder"]["board"]["columns"][number]["cards"][number];
export type RepairOrderDetail = RouterOutputs["repairOrder"]["get"];
export type RepairOrderLineDetail = RepairOrderDetail["lines"][number];
export type ReceptionHit = RouterOutputs["repairOrder"]["receptionLookup"][number];
export type CatalogItem = RouterOutputs["repairOrder"]["catalog"][number];
