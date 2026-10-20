// RG-M13-37 — `PATCH|DELETE /api/v1/webhook-endpoints/{id}`.
import { apiRoute } from "@/server/publicApi/http";
import { deleteEndpointRoute, patchEndpointRoute } from "@/server/publicApi/webhookRoutes";

export const dynamic = "force-dynamic";
export const PATCH = apiRoute<{ id: string }>({ scope: "webhooks:manage" }, patchEndpointRoute);
export const DELETE = apiRoute<{ id: string }>({ scope: "webhooks:manage" }, deleteEndpointRoute);
