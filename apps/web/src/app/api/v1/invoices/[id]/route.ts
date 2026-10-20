// RG-M13-37 — `GET /api/v1/invoices/{id}` (lignes comprises).
import { apiRoute } from "@/server/publicApi/http";
import { getInvoice } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute<{ id: string }>({ scope: "invoices:read" }, getInvoice);
