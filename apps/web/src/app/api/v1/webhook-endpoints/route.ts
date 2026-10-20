// RG-M13-37 — `GET|POST /api/v1/webhook-endpoints`.
import { apiRoute } from "@/server/publicApi/http";
import { createEndpointRoute, listEndpoints } from "@/server/publicApi/webhookRoutes";

export const dynamic = "force-dynamic";
export const GET = apiRoute({ scope: "webhooks:manage" }, listEndpoints);
export const POST = apiRoute({ scope: "webhooks:manage" }, createEndpointRoute);
