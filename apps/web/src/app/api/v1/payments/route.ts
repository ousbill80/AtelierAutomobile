// RG-M13-37 — `GET /api/v1/payments` (affectations comprises).
import { apiRoute } from "@/server/publicApi/http";
import { listPayments } from "@/server/publicApi/resources";

export const dynamic = "force-dynamic";
export const GET = apiRoute({ scope: "payments:read" }, listPayments);
