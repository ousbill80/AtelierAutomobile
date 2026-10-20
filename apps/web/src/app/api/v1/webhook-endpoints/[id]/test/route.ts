// RG-M13-37 — `POST /api/v1/webhook-endpoints/{id}/test` : livraison de test signée.
import { apiRoute } from "@/server/publicApi/http";
import { testEndpointRoute } from "@/server/publicApi/webhookRoutes";

export const dynamic = "force-dynamic";
export const POST = apiRoute<{ id: string }>({ scope: "webhooks:manage" }, testEndpointRoute);
