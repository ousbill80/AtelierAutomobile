import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type QuoteListItem = RouterOutputs["quote"]["list"]["items"][number];
export type QuoteDetail = RouterOutputs["quote"]["get"];
export type QuoteLineDetail = QuoteDetail["lines"][number];
export type QuoteGroup = QuoteDetail["groups"][number];
export type QuoteCatalogItem = RouterOutputs["quote"]["catalog"][number];
export type PortalQuote = RouterOutputs["portal"]["quote"]["get"];
export type QuoteStatsOutput = RouterOutputs["quote"]["stats"];
export type LaborOperationRow = RouterOutputs["laborOperation"]["list"][number];
export type QuoteSettingsOutput = RouterOutputs["quote"]["settings"];
