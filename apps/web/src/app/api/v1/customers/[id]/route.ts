// RG-M13-37 — `GET|PATCH /api/v1/customers/{id}`.
import { apiRoute } from "@/server/publicApi/http";
import { getCustomer, patchCustomer } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute<{ id: string }>({ scope: "customers:read" }, getCustomer);
export const PATCH = apiRoute<{ id: string }>({ scope: "customers:write" }, patchCustomer);
