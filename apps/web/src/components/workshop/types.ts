import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type WorkshopCard = RouterOutputs["workshop"]["board"]["columns"][number]["cards"][number];
export type ColumnKey = RouterOutputs["workshop"]["board"]["columns"][number]["key"];
export type TechSnapshot = RouterOutputs["tech"]["bootstrap"];
export type TechTask = TechSnapshot["tasks"][number];
