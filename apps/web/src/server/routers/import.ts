import { TRPCError } from "@trpc/server";
import {
  headerSignature as computeHeaderSignature,
  TARGET_FIELDS_BY_ENTITY,
  type DetectedEncoding,
} from "@atelieros/core";
import { db, writeAuditLog } from "@atelieros/db";
import {
  buildJobRows,
  dedupeImportRows,
  detectFileFormat,
  isSupportedEntity,
  parseImportFile,
  rollbackImport,
  rowHasBlockingError,
  simulateImport,
  suggestColumnMapping,
  suggestEntity,
  type ImportEntityName,
  type ImportJobMapping,
  type SupportedEntity,
} from "@atelieros/import";
import {
  analyzeInputSchema,
  errorReportInputSchema,
  listImportsInputSchema,
  patchRowInputSchema,
  progressInputSchema,
  rollbackInputSchema,
  runInputSchema,
  setMappingInputSchema,
  simulateInputSchema,
  templateInputSchema,
  uploadInputSchema,
  validateInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { getImportJobQueue } from "../queue";
import { getObjectStorage } from "../storage";
import { enrichMappingWithAi } from "../ai/extraction";

/**
 * Formats acceptés (RG-M13-01) : CSV/TXT délimités et classeurs Excel
 * `.xlsx`/`.xls`. `detectFileFormat` (extension du nom de fichier) reste la
 * source de vérité pour le parsing ; ce set ne filtre que les types MIME du
 * navigateur à l'upload, qui varient selon le système/navigateur.
 */
const ACCEPTED_MIME_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo (RG-M13-01)
const MAX_ROWS = 100_000; // RG-M13-01
const ROLLBACK_WINDOW_DAYS = 7; // RG-M13-24

function objectKey(organizationId: string, jobId: string, name: string): string {
  return `imports/${organizationId}/${jobId}/${name}`;
}

async function loadJobOrThrow(tenantDb: ReturnType<typeof db.forTenant>, jobId: string) {
  const job = await tenantDb.importJob.findFirst({ where: { id: jobId } });
  if (!job) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Import introuvable." });
  }
  return job;
}

function assertSupportedEntity(entity: string): asserts entity is SupportedEntity {
  if (!isSupportedEntity(entity as ImportEntityName)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Cette opération n'est prise en charge que pour les clients, véhicules, factures et paiements dans cette étape.",
    });
  }
}

export const importRouter = router({
  upload: requirePermission("import:run")
    .input(uploadInputSchema)
    .mutation(async ({ ctx, input }) => {
      const format = detectFileFormat(input.fileName);
      if (!format || !ACCEPTED_MIME_TYPES.has(input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Format non supporté : seuls CSV, TXT, XLSX et XLS sont acceptés.",
        });
      }
      if (input.size > MAX_FILE_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fichier trop volumineux (limite 20 Mo).",
        });
      }

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await tenantDb.importJob.create({
        data: {
          organizationId: ctx.organizationId,
          entity: "mixed",
          fileName: input.fileName,
          status: "PENDING",
          createdById: ctx.membership.id,
        },
      });

      const key = objectKey(ctx.organizationId, job.id, `source.${format}`);
      const storage = getObjectStorage();
      const uploadUrl = await storage.getSignedUploadUrl(key, input.mimeType);
      await tenantDb.importJob.update({ where: { id: job.id }, data: { fileUrl: key } });

      return { jobId: job.id, uploadUrl };
    }),

  analyze: requirePermission("import:run")
    .input(analyzeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await loadJobOrThrow(tenantDb, input.jobId);
      if (!job.fileUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Le fichier n'a pas encore été reçu.",
        });
      }

      const storage = getObjectStorage();
      const bytes = await storage.getObjectBytes(job.fileUrl);
      const parsed = await parseImportFile(bytes, {
        fileName: job.fileName ?? job.fileUrl,
        forcedEncoding: input.encoding as DetectedEncoding | undefined,
        forcedDelimiter: input.delimiter,
      });

      if (parsed.rows.length > MAX_ROWS) {
        await tenantDb.importJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Fichier trop volumineux (limite ${MAX_ROWS} lignes).`,
        });
      }

      const signature = await computeHeaderSignature(parsed.headers);
      const previousJob = await tenantDb.importJob.findFirst({
        where: { headerSignature: signature, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
      });
      const memorized = (previousJob?.mapping as ImportJobMapping | null)?.columns;
      const synonymMapping = suggestColumnMapping(parsed.headers, memorized);
      const suggestedEntity = suggestEntity(synonymMapping);
      // M17 / RG-M13-07 : colonnes < 0,7 proposées par l'IA (jamais bloquant).
      const mapping = await enrichMappingWithAi({
        organizationId: ctx.organizationId,
        membershipId: ctx.membership.id,
        importJobId: job.id,
        mapping: synonymMapping,
        headers: parsed.headers,
        rows: parsed.rows.map((row) => row.map((cell) => String(cell ?? ""))),
        targetFields: [...new Set(Object.values(TARGET_FIELDS_BY_ENTITY).flat())],
      });

      await tenantDb.importJob.update({
        where: { id: job.id },
        data: {
          encoding: parsed.encoding,
          delimiter: parsed.delimiter,
          headerSignature: signature,
          totalRows: parsed.rows.length,
          status: "VALIDATING",
        },
      });

      const samples = parsed.headers.map((column, index) => ({
        column,
        samples: parsed.rows.slice(0, 3).map((row) => row[index] ?? ""),
      }));

      return {
        headers: parsed.headers,
        samples,
        detected: { encoding: parsed.encoding, delimiter: parsed.delimiter },
        suggestedEntity,
        mapping,
      };
    }),

  setMapping: requirePermission("import:run")
    .input(setMappingInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await loadJobOrThrow(tenantDb, input.jobId);

      await tenantDb.importJob.update({
        where: { id: input.jobId },
        data: {
          entity: input.entity,
          policy: input.options.policy,
          mapping: { columns: input.columns, options: input.options },
        },
      });

      return { ok: true as const };
    }),

  validate: requirePermission("import:run")
    .input(validateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await loadJobOrThrow(tenantDb, input.jobId);
      const jobMapping = (job.mapping as ImportJobMapping) ?? {};

      const storage = getObjectStorage();
      const { rows } = await buildJobRows(
        storage,
        {
          fileUrl: job.fileUrl,
          fileName: job.fileName,
          encoding: job.encoding,
          delimiter: job.delimiter,
        },
        job.entity as ImportEntityName,
        jobMapping,
        new Date(),
      );

      const errorCount = rows.filter((r) => rowHasBlockingError(r)).length;
      const warningCount = rows.filter(
        (r) => !rowHasBlockingError(r) && r.issues.some((i) => i.severity === "WARNING"),
      ).length;

      await tenantDb.importJob.update({
        where: { id: job.id },
        data: { errorCount, warningCount },
      });

      const cursor = input.cursor ?? 0;
      const page = rows.slice(cursor, cursor + 50);

      return {
        rows: page,
        counts: { total: rows.length, errors: errorCount, warnings: warningCount },
      };
    }),

  patchRow: requirePermission("import:run")
    .input(patchRowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await loadJobOrThrow(tenantDb, input.jobId);
      const jobMapping = (job.mapping as ImportJobMapping) ?? {};
      const overrides = { ...(jobMapping.overrides ?? {}) };
      const rowKey = String(input.rowNumber);
      overrides[rowKey] = { ...(overrides[rowKey] ?? {}), [input.field]: input.value };
      const nextMapping: ImportJobMapping = { ...jobMapping, overrides };

      await tenantDb.importJob.update({
        where: { id: job.id },
        data: { mapping: nextMapping },
      });

      const storage = getObjectStorage();
      const { rows } = await buildJobRows(
        storage,
        {
          fileUrl: job.fileUrl,
          fileName: job.fileName,
          encoding: job.encoding,
          delimiter: job.delimiter,
        },
        job.entity as ImportEntityName,
        nextMapping,
        new Date(),
      );
      const row = rows.find((r) => r.rowNumber === input.rowNumber);
      return { issues: row?.issues ?? [] };
    }),

  simulate: requirePermission("import:run")
    .input(simulateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await loadJobOrThrow(tenantDb, input.jobId);
      assertSupportedEntity(job.entity);

      const jobMapping = (job.mapping as ImportJobMapping) ?? {};
      const storage = getObjectStorage();
      const { rows } = await buildJobRows(
        storage,
        {
          fileUrl: job.fileUrl,
          fileName: job.fileName,
          encoding: job.encoding,
          delimiter: job.delimiter,
        },
        job.entity,
        jobMapping,
        new Date(),
      );

      const summary = await simulateImport({
        tenantDb,
        organizationId: ctx.organizationId,
        entity: job.entity,
        rows,
        policy: job.policy,
        jobId: job.id,
        now: new Date(),
      });

      await tenantDb.importJob.update({
        where: { id: job.id },
        data: { status: "READY", summary },
      });

      return summary;
    }),

  run: requirePermission("import:run")
    .input(runInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await loadJobOrThrow(tenantDb, input.jobId);
      assertSupportedEntity(job.entity);

      // Vérification immédiate (avant mise en file) pour un retour synchrone à
      // l'utilisateur, plutôt que de laisser échouer le job après mise en file.
      const jobMapping = (job.mapping as ImportJobMapping) ?? {};
      const storage = getObjectStorage();
      const { rows } = await buildJobRows(
        storage,
        {
          fileUrl: job.fileUrl,
          fileName: job.fileName,
          encoding: job.encoding,
          delimiter: job.delimiter,
        },
        job.entity,
        jobMapping,
        new Date(),
      );
      const { winningRows } = dedupeImportRows(job.entity, rows);
      const blocking = winningRows.filter((r) => rowHasBlockingError(r));
      if (blocking.length > 0 && !input.skipErrors) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${blocking.length} ligne(s) en erreur. Corrigez-les ou cochez « ignorer les erreurs ».`,
        });
      }

      // Mise en file (RG-M13-24) : le pilote `inline` (défaut tests/local sans
      // worker) traite immédiatement et synchroniquement ; le pilote `bullmq`
      // (dev/prod, voir `apps/worker`) ne fait qu'ajouter le job — le statut
      // restera `READY` jusqu'à ce que le worker le prenne en charge (passage
      // à `RUNNING` dans `processImportRunJob`), le client suit alors la
      // progression via `import.progress`.
      await getImportJobQueue().enqueueRun({
        jobId: job.id,
        organizationId: ctx.organizationId,
        skipErrors: input.skipErrors,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
      });

      const finalJob = await loadJobOrThrow(tenantDb, job.id);
      return { status: finalJob.status };
    }),

  progress: requirePermission("import:run")
    .input(progressInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await loadJobOrThrow(tenantDb, input.jobId);
      return {
        status: job.status,
        processedRows: job.processedRows,
        totalRows: job.totalRows,
        counts: {
          create: job.createdCount,
          update: job.updatedCount,
          unchanged: job.unchangedCount,
          skip: job.skippedCount,
          error: job.errorCount,
        },
      };
    }),

  errorReport: requirePermission("import:run")
    .input(errorReportInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await loadJobOrThrow(tenantDb, input.jobId);
      const errors = await tenantDb.importRowError.findMany({
        where: { importJobId: job.id },
        orderBy: { rowNumber: "asc" },
      });

      const header = "Ligne;Champ;Sévérité;Erreur\n";
      const lines = errors.map(
        (e) => `${e.rowNumber};${e.field ?? ""};${e.severity};"${e.message.replace(/"/g, '""')}"`,
      );
      const csv = header + lines.join("\n");

      const storage = getObjectStorage();
      const key = objectKey(ctx.organizationId, job.id, "error-report.csv");
      await storage.upload({ key, body: new TextEncoder().encode(csv), contentType: "text/csv" });
      await tenantDb.importJob.update({ where: { id: job.id }, data: { errorReportUrl: key } });

      const url = await storage.getSignedDownloadUrl(key, 900);
      return { url };
    }),

  rollback: requirePermission("import:run")
    .input(rollbackInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const job = await loadJobOrThrow(tenantDb, input.jobId);

      if (job.status !== "COMPLETED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seul un import terminé peut être annulé.",
        });
      }
      assertSupportedEntity(job.entity);
      const ageMs = Date.now() - (job.finishedAt?.getTime() ?? 0);
      if (ageMs > ROLLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ce job a plus de 7 jours : annulation impossible.",
        });
      }

      const result = await rollbackImport({ tenantDb, entity: job.entity, jobId: job.id });

      // Audit (CLAUDE.md : « actions sensibles → AuditLog avec motif ») — le
      // motif saisi par l'utilisateur (`input.reason`) n'est pas porté par
      // `rollbackImport` (générique, réutilisé par le futur rollback
      // automatique) : on le journalise ici, au niveau de l'action déclenchée
      // par l'utilisateur.
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "import.rollback",
        entity: "ImportJob",
        entityId: job.id,
        after: { reverted: result.reverted, conflicts: result.conflicts },
        reason: input.reason,
      });

      return result;
    }),

  list: requirePermission("import:run")
    .input(listImportsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const jobs = await tenantDb.importJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      return {
        jobs,
        nextCursor: jobs.length === 20 ? jobs[jobs.length - 1]?.id : undefined,
      };
    }),

  template: requirePermission("import:run")
    .input(templateInputSchema)
    .mutation(async ({ input }) => {
      const templates: Record<string, { headers: string[]; example: string[] }> = {
        customers: {
          headers: ["Nom & Prénoms", "Téléphone", "Email"],
          example: ["Kouassi Jean-Marc", "+225 07 47 21 88 90", "jm.kouassi@example.com"],
        },
        vehicles: {
          headers: ["Immatriculation", "Marque", "Modèle"],
          example: ["2547 GH 01", "Toyota", "Corolla"],
        },
        invoices: {
          headers: ["N° facture", "Date facture", "Montant TTC", "Réglé"],
          example: ["FAC-0412", "01/10/2026", "185000", "185000"],
        },
        payments: {
          headers: ["N° facture", "Montant", "Date règlement"],
          example: ["FAC-0412", "185000", "01/10/2026"],
        },
        products: {
          headers: ["Référence", "Désignation", "Prix vente", "Stock"],
          example: ["REF-1", "Filtre à huile", "5000", "10"],
        },
        repair_orders: {
          headers: ["Plaque", "Date", "Kilométrage"],
          example: ["2547 GH 01", "01/10/2026", "50000"],
        },
        mixed: {
          headers: ["Nom & Prénoms", "Téléphone", "Immatriculation", "Marque"],
          example: ["Kouassi Jean-Marc", "+225 07 47 21 88 90", "2547 GH 01", "Toyota"],
        },
      };
      const template = templates[input.entity] ?? templates.mixed!;
      const csv = `${template.headers.join(";")}\n${template.example.join(";")}`;

      const storage = getObjectStorage();
      const key = `templates/${input.entity}.csv`;
      await storage.upload({ key, body: new TextEncoder().encode(csv), contentType: "text/csv" });
      const url = await storage.getSignedDownloadUrl(key, 900);
      return { url };
    }),
});
