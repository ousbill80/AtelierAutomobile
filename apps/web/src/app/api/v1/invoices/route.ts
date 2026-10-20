// RG-M13-37 — `GET /api/v1/invoices` (filtres status, customer_id, due_before, updated_since).
import { apiRoute } from "@/server/publicApi/http";
import { listInvoices } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute({ scope: "invoices:read" }, listInvoices);
