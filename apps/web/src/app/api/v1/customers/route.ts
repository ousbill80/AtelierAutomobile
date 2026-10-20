// RG-M13-37 — `GET|POST /api/v1/customers`.
import { apiRoute } from "@/server/publicApi/http";
import { createCustomer, listCustomers } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute({ scope: "customers:read" }, listCustomers);
export const POST = apiRoute({ scope: "customers:write" }, createCustomer);
