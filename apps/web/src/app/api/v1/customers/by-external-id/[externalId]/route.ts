// RG-M13-36 — `PUT /api/v1/customers/by-external-id/{external_id}` : upsert.
import { apiRoute } from "@/server/publicApi/http";
import { upsertCustomerByExternalId } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const PUT = apiRoute<{ externalId: string }>(
  { scope: "customers:write" },
  upsertCustomerByExternalId,
);
