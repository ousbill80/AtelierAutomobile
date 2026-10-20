// RG-M13-37 — `GET /api/v1/customers/{id}/balance` : solde dû et factures ouvertes.
import { apiRoute } from "@/server/publicApi/http";
import { customerBalance } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute<{ id: string }>({ scope: "invoices:read" }, customerBalance);
