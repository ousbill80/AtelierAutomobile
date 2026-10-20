// RG-M13-37 — spécification OpenAPI 3.1 de l'API publique, générée depuis les schémas Zod des
// corps de requête (zod-to-json-schema) ; servie à `/api/v1/openapi.json`.
import { API_SCOPES, WEBHOOK_EVENTS } from "@atelieros/core";
import {
  apiCustomerCreateSchema,
  apiCustomerPatchSchema,
  apiVehicleCreateSchema,
  apiWebhookEndpointCreateSchema,
  apiWebhookEndpointPatchSchema,
} from "@atelieros/validators";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

function schema(s: ZodTypeAny) {
  const out = zodToJsonSchema(s, { target: "openApi3", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete out.$schema;
  return out;
}

const listParams = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
  { name: "cursor", in: "query", schema: { type: "string" } },
  { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" } },
];
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const idempotency = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", maxLength: 255 },
  description: "Obligatoire sur tout POST ; conservée 24 h (RG-M13-33).",
};
const errors = {
  "401": { $ref: "#/components/responses/Error" },
  "403": { $ref: "#/components/responses/Error" },
  "422": { $ref: "#/components/responses/Error" },
  "429": { $ref: "#/components/responses/Error" },
};
const ok = (description: string) => ({ description, content: { "application/json": {} } });
const op = (scope: string | null, summary: string, extra: Record<string, unknown> = {}) => ({
  summary,
  ...(scope ? { "x-scope": scope, security: [{ bearer: [] }] } : { security: [{ bearer: [] }] }),
  responses: { "200": ok("Succès"), ...errors },
  ...extra,
});
const body = (s: ZodTypeAny) => ({
  required: true,
  content: { "application/json": { schema: schema(s) } },
});

export function buildOpenApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "API AtelierOS",
      version: "1.0.0",
      description:
        "API REST publique d'AtelierOS : JSON snake_case, montants en FCFA entiers, dates AAAA-MM-JJ, horodatages ISO 8601 UTC. Authentification `Authorization: Bearer ak_live_…`.",
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "ak_live_…" } },
      responses: {
        Error: {
          description: "Erreur",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: {
                    type: "object",
                    properties: {
                      code: { type: "string" },
                      message: { type: "string" },
                      details: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: { field: { type: "string" }, issue: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "x-scopes": API_SCOPES,
    "x-webhook-events": WEBHOOK_EVENTS,
    paths: {
      "/me": { get: op(null, "Organisation, droits et limites de la clé") },
      "/customers": {
        get: op("customers:read", "Lister les clients", {
          parameters: [...listParams, { name: "phone", in: "query", schema: { type: "string" } }],
        }),
        post: op("customers:write", "Créer un client", {
          parameters: [idempotency],
          requestBody: body(apiCustomerCreateSchema),
        }),
      },
      "/customers/{id}": {
        get: op("customers:read", "Détail d'un client", { parameters: [idParam] }),
        patch: op("customers:write", "Modifier un client", {
          parameters: [idParam],
          requestBody: body(apiCustomerPatchSchema),
        }),
      },
      "/customers/{id}/balance": {
        get: op("invoices:read", "Solde dû et factures ouvertes", { parameters: [idParam] }),
      },
      "/customers/by-external-id/{external_id}": {
        put: op("customers:write", "Créer ou modifier par identifiant externe", {
          parameters: [
            { name: "external_id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: body(apiCustomerCreateSchema),
        }),
      },
      "/vehicles": {
        get: op("vehicles:read", "Lister les véhicules", {
          parameters: [
            ...listParams,
            { name: "plate", in: "query", schema: { type: "string" } },
            { name: "customer_id", in: "query", schema: { type: "string" } },
            {
              name: "inspection_expiry_before",
              in: "query",
              schema: { type: "string", format: "date" },
            },
          ],
        }),
        post: op("vehicles:write", "Créer un véhicule", {
          parameters: [idempotency],
          requestBody: body(apiVehicleCreateSchema),
        }),
      },
      "/vehicles/{id}": {
        get: op("vehicles:read", "Détail d'un véhicule", { parameters: [idParam] }),
      },
      "/invoices": {
        get: op("invoices:read", "Lister les factures émises", {
          parameters: [
            ...listParams,
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "customer_id", in: "query", schema: { type: "string" } },
            { name: "due_before", in: "query", schema: { type: "string", format: "date" } },
          ],
        }),
      },
      "/invoices/{id}": {
        get: op("invoices:read", "Détail d'une facture", { parameters: [idParam] }),
      },
      "/payments": {
        get: op("payments:read", "Lister les paiements", {
          parameters: [
            ...listParams,
            { name: "customer_id", in: "query", schema: { type: "string" } },
          ],
        }),
      },
      "/webhook-endpoints": {
        get: op("webhooks:manage", "Lister les webhooks"),
        post: op("webhooks:manage", "Créer un webhook (secret renvoyé une seule fois)", {
          parameters: [idempotency],
          requestBody: body(apiWebhookEndpointCreateSchema),
        }),
      },
      "/webhook-endpoints/{id}": {
        patch: op("webhooks:manage", "Modifier un webhook", {
          parameters: [idParam],
          requestBody: body(apiWebhookEndpointPatchSchema),
        }),
        delete: op("webhooks:manage", "Supprimer un webhook", { parameters: [idParam] }),
      },
      "/webhook-endpoints/{id}/test": {
        post: op("webhooks:manage", "Envoyer une livraison de test", {
          parameters: [idParam, idempotency],
        }),
      },
    },
  };
}
