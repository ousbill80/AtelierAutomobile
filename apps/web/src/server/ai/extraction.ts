// M17 — lot « extraction et correspondance de colonnes » :
// - `ai.extractDocument` (US-M17-06, RG-M17-18, M02 `vehicle.scanRegistration`, M16 constat) :
//   photo → champs proposés avec confiance, normalisés par le code ; `AiSuggestion` créée,
//   **rien d'autre n'est écrit** : le formulaire normal (vehicle.create, claim.create…) crée
//   l'objet avec ses propres permissions, puis appelle `ai.suggestion.accept` pour tracer la
//   décision (editDistance entre champs proposés et champs enregistrés).
// - `ai.mapColumns` (US-M17-05, RG-M17-17, M13 RG-M13-07) et `aiMapColumns`, branché dans
//   `import.analyze`.
// Écart PRD : l'entrée est l'image elle-même (`image.dataBase64`) et non un `uploadId` : le
// navigateur la redimensionne à 1 600 px via canvas (ce qui supprime l'EXIF) ; ≤ 5 Mo vérifié
// ici. La photo n'est pas conservée en `Attachment` dans cette étape.
import {
  AI_MAPPING_THRESHOLD,
  DOCUMENT_KINDS,
  filterAiMappings,
  invoiceTotalGap,
  maskSamples,
  matchSupplierInvoiceLines,
  mergeAiMappings,
  normalizeExtraction,
  type AiColumnMapping,
  type DocumentKind,
  type MappingEntryLike,
  type Permission,
} from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  COLUMN_MAPPING_PROMPT_VERSION,
  COLUMN_MAPPING_SYSTEM,
  columnMappingConsoleOutput,
  columnMappingMessages,
  columnMappingOutputSchema,
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
  documentExtractionConsoleOutput,
  documentExtractionMessages,
  documentExtractionOutputSchema,
  documentExtractionSystem,
} from "@atelieros/integrations";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requirePermission } from "../trpc";
import { registerAcceptHandler } from "./accept";
import { getAiService } from "./service";
import { createSuggestion } from "./suggestions";

/** RG-M17-18 — image ≤ 5 Mo après redimensionnement. */
export const MAX_EXTRACTION_IMAGE_BYTES = 5 * 1024 * 1024;

/** Permission métier exigée par type de document (en plus de `ai:use`). */
const KIND_PERMISSIONS: Record<DocumentKind, Permission[]> = {
  VEHICLE_REGISTRATION: ["vehicle:create", "vehicle:update"],
  INSPECTION_STICKER: ["vehicle:create", "vehicle:update"],
  ODOMETER: ["vehicle:update"],
  SUPPLIER_INVOICE: ["stock:receive"],
  CLAIM_REPORT: ["insurance:manage"],
};

const KIND_TARGET: Record<DocumentKind, string> = {
  VEHICLE_REGISTRATION: "vehicle",
  INSPECTION_STICKER: "vehicle",
  ODOMETER: "vehicle",
  SUPPLIER_INVOICE: "purchase_order",
  CLAIM_REPORT: "insurance_claim",
};

function assertKindPermission(permissions: Set<Permission>, kind: DocumentKind): void {
  if (!KIND_PERMISSIONS[kind].some((p) => permissions.has(p))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Vous n'avez pas les droits pour enregistrer ce type de document.",
    });
  }
}

export const extractDocumentInputSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  image: z.object({
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    dataBase64: z.string().min(1),
  }),
});

function decodedSize(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export const mapColumnsInputSchema = z.object({
  importJobId: z.string().min(1),
  columns: z
    .array(z.object({ header: z.string().min(1).max(200), samples: z.array(z.string()).max(50) }))
    .min(1)
    .max(200),
  targetFields: z.array(z.string().min(1).max(100)).min(1).max(100),
});

export interface AiMapColumnsInput {
  organizationId: string;
  membershipId: string | null;
  importJobId: string;
  columns: { header: string; samples: string[] }[];
  targetFields: string[];
}

/**
 * RG-M13-07 — envoie les colonnes à l'IA avec 5 exemples masqués, filtre la sortie aux
 * champs cibles. IA indisponible → `{ ok: false }`, l'appelant laisse les colonnes « à associer ».
 */
export async function aiMapColumns(
  input: AiMapColumnsInput,
): Promise<{ ok: true; mappings: AiColumnMapping[] } | { ok: false; reason: string }> {
  const prompt = {
    columns: input.columns.map((c) => ({ header: c.header, samples: maskSamples(c.samples) })),
    targetFields: input.targetFields,
  };
  const result = await getAiService().runStructured({
    feature: "column_mapping",
    promptVersion: COLUMN_MAPPING_PROMPT_VERSION,
    ctx: { organizationId: input.organizationId, membershipId: input.membershipId },
    inputRef: `import_job:${input.importJobId}`,
    system: COLUMN_MAPPING_SYSTEM,
    messages: columnMappingMessages(prompt),
    schema: columnMappingOutputSchema,
    maxTokens: 2_000,
    consoleOutput: () => columnMappingConsoleOutput(prompt),
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    mappings: filterAiMappings(
      result.output.mappings,
      input.columns.map((c) => c.header),
      input.targetFields,
    ),
  };
}

/**
 * `import.analyze` — complète la correspondance par synonymes : colonnes < 0,7 (hors
 * correspondance mémorisée) proposées par l'IA ; échec silencieux (import jamais bloqué).
 */
export async function enrichMappingWithAi<T extends MappingEntryLike>(args: {
  organizationId: string;
  membershipId: string | null;
  importJobId: string;
  mapping: T[];
  headers: string[];
  rows: string[][];
  targetFields: string[];
}) {
  const weak = args.mapping.filter(
    (m) => m.source !== "memory" && m.confidence < AI_MAPPING_THRESHOLD,
  );
  if (!weak.length) return args.mapping;
  try {
    const result = await aiMapColumns({
      organizationId: args.organizationId,
      membershipId: args.membershipId,
      importJobId: args.importJobId,
      targetFields: args.targetFields,
      columns: weak.map((m) => {
        const index = args.headers.indexOf(m.column);
        return {
          header: m.column,
          samples: args.rows.slice(0, 20).map((row) => String(row[index] ?? "")),
        };
      }),
    });
    return result.ok ? mergeAiMappings(args.mapping, result.mappings) : args.mapping;
  } catch {
    return args.mapping;
  }
}

registerAcceptHandler("extraction", {
  // Permission métier vérifiée selon le type de document (pas d'écriture ici : la création
  // passe par la procédure du formulaire, avec ses propres droits).
  permissions: [],
  async run({ ctx, suggestion, editedPayload }) {
    const payload = suggestion.payload as {
      kind: DocumentKind;
      fields: Record<string, { value: string | number }>;
    };
    assertKindPermission(ctx.permissions, payload.kind);
    const proposed = Object.fromEntries(
      Object.entries(payload.fields).map(([k, f]) => [k, String(f.value)]),
    );
    const finalFields =
      editedPayload && typeof editedPayload === "object" && "fields" in editedPayload
        ? ((editedPayload as { fields: Record<string, unknown> }).fields ?? {})
        : proposed;
    const final = Object.fromEntries(
      Object.keys(proposed).map((k) => [k, finalFields[k] == null ? "" : String(finalFields[k])]),
    );
    return {
      result: { fields: payload.fields },
      original: JSON.stringify(proposed),
      final: JSON.stringify(final),
    };
  },
});

export const extractionProcedures = {
  extractDocument: requirePermission("ai:use")
    .input(extractDocumentInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertKindPermission(ctx.permissions, input.kind);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image.dataBase64)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Image invalide." });
      }
      if (decodedSize(input.image.dataBase64) > MAX_EXTRACTION_IMAGE_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Photo trop lourde (5 Mo maximum). Reprenez-la ou réduisez sa taille.",
        });
      }
      const now = new Date();
      const result = await getAiService().runStructured({
        feature: "document_extraction",
        promptVersion: DOCUMENT_EXTRACTION_PROMPT_VERSION,
        ctx: { organizationId: ctx.organizationId, membershipId: ctx.membership.id },
        inputRef: `document:${input.kind}`,
        system: documentExtractionSystem(input.kind),
        messages: documentExtractionMessages({ kind: input.kind, ...input.image }),
        schema: documentExtractionOutputSchema,
        maxTokens: 3_000,
        consoleOutput: () => documentExtractionConsoleOutput(input.kind),
      });
      if (!result.ok) {
        // Repli RG-M17-08 : saisie manuelle.
        return { ok: false as const, reason: result.reason };
      }
      const normalized = result.output.readable
        ? normalizeExtraction(input.kind, result.output.fields, now)
        : normalizeExtraction(input.kind, {}, now);

      let lines: ReturnType<typeof matchSupplierInvoiceLines> | undefined;
      let totalGap: number | null = null;
      if (input.kind === "SUPPLIER_INVOICE" && result.output.lines?.length) {
        const tx = db.forTenant({ organizationId: ctx.organizationId });
        const products = await tx.product.findMany({
          where: { isActive: true },
          select: { id: true, sku: true, name: true, oemReference: true },
        });
        lines = matchSupplierInvoiceLines(result.output.lines, products);
        const total = normalized.fields.total?.value;
        totalGap = invoiceTotalGap(lines, typeof total === "number" ? total : null);
        if (totalGap) {
          normalized.warnings.push(
            `Écart entre le total et la somme des lignes : ${totalGap} FCFA.`,
          );
        }
      }

      if (normalized.unreadable) {
        return { ok: true as const, suggestionId: null, ...normalized, lines, totalGap };
      }
      const tx = db.forTenant({ organizationId: ctx.organizationId });
      const suggestion = await createSuggestion(tx, {
        organizationId: ctx.organizationId,
        interactionId: result.interactionId,
        feature: "extraction",
        targetEntity: KIND_TARGET[input.kind],
        targetId: null,
        payload: { kind: input.kind, ...normalized, lines, totalGap },
        isFallback: false,
        now,
      });
      return { ok: true as const, suggestionId: suggestion.id, ...normalized, lines, totalGap };
    }),

  mapColumns: requirePermission("ai:use", "import:run")
    .input(mapColumnsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tx = db.forTenant({ organizationId: ctx.organizationId });
      const job = await tx.importJob.findFirst({
        where: { id: input.importJobId },
        select: { id: true },
      });
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Import introuvable." });
      const result = await aiMapColumns({
        organizationId: ctx.organizationId,
        membershipId: ctx.membership.id,
        importJobId: job.id,
        columns: input.columns,
        targetFields: input.targetFields,
      });
      return result.ok
        ? { available: true as const, mappings: result.mappings }
        : { available: false as const, reason: result.reason, mappings: [] };
    }),
};
