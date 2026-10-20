// M15 RG-M15-21 / US-M15-08 — tâche `org.export` (file « exports ») : archive ZIP de toutes les
// données de l'organisation (un CSV par table, photos, factures émises en PDF, LISEZMOI.txt),
// déposée dans S3 et téléchargeable 48 h via /api/exports/{id}. Toutes les lectures passent par
// db.forTenant (RLS) et chaque ligne est revérifiée : aucune donnée d'une autre organisation.
import { strToU8, zipSync, type Zippable } from "fflate";
import {
  csvHeader,
  csvRows,
  exportableColumns,
  exportExpiry,
  exportReadme,
  formatDate,
  shouldExportTable,
  systemClock,
  tableFileName,
  type Clock,
} from "@atelieros/core";
import {
  adminDb,
  buildInvoicePdfData,
  db,
  Prisma,
  type Invoice,
  type InvoicePdfGarage,
} from "@atelieros/db";
import { logger } from "../logger";

type TenantDb = ReturnType<typeof db.forTenant>;
type Delegate = { findMany: (args: unknown) => Promise<Record<string, unknown>[]> };

/** Stockage minimal requis (S3 en production, mémoire dans les tests). */
export interface ExportStorage {
  upload(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    maxBytes?: number;
  }): Promise<{ key: string }>;
  getObjectBytes(key: string): Promise<Uint8Array>;
}

export type InvoicePdfRenderer = (
  data: Awaited<ReturnType<typeof buildInvoicePdfData>>,
) => Promise<Uint8Array>;

export interface OrgExportDeps {
  storage: ExportStorage;
  clock?: Clock;
  /** Rendu PDF des factures émises ; absent = pas de dossier documents/ (tests). */
  renderInvoicePdf?: InvoicePdfRenderer;
}

export interface OrgExportJobData {
  organizationId: string;
  exportId: string;
}

const PAGE_SIZE = 1_000;
/** Archive en mémoire : au-delà, l'export échoue proprement (FAILED) plutôt que de saturer le worker. */
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

const uncapitalize = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

/** Modèles rattachés à une organisation, colonnes scalaires exportables (DMMF, pas de liste à la main). */
export function exportableModels() {
  return Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((f) => f.name === "organizationId"))
    .filter((model) => shouldExportTable(model.name))
    .map((model) => ({
      name: model.name,
      hasId: model.fields.some((f) => f.name === "id"),
      columns: exportableColumns(
        model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name),
      ),
    }));
}

async function collectTable(
  tenantDb: TenantDb,
  organizationId: string,
  model: { name: string; hasId: boolean; columns: string[] },
): Promise<{ csv: string; rows: number }> {
  const delegate = (tenantDb as unknown as Record<string, Delegate>)[uncapitalize(model.name)]!;
  let csv = csvHeader(model.columns);
  let rows = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await delegate.findMany({
      where: { organizationId },
      ...(model.hasId
        ? {
            orderBy: { id: "asc" },
            take: PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          }
        : {}),
    });
    // Ceinture et bretelles : la RLS filtre déjà ; les catalogues globaux (organizationId null)
    // et toute ligne étrangère sont écartés ici.
    const own = page.filter((row) => row.organizationId === organizationId);
    csv += csvRows(model.columns, own);
    rows += own.length;
    if (!model.hasId || page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1]!.id as string;
  }
  return { csv, rows };
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function runOrgExport(data: OrgExportJobData, deps: OrgExportDeps): Promise<void> {
  const clock = deps.clock ?? systemClock;
  const { organizationId, exportId } = data;
  const tenantDb = db.forTenant({ organizationId });

  const claimed = await tenantDb.dataExport.updateMany({
    where: { id: exportId, status: "PENDING" },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) return; // déjà traité, en cours ou inconnu (idempotence)

  try {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const files: Zippable = {};
    const tables: { file: string; rows: number }[] = [];
    let rowCount = 0;

    for (const model of exportableModels()) {
      const { csv, rows } = await collectTable(tenantDb, organizationId, model);
      const file = tableFileName(model.name);
      files[file] = strToU8(csv);
      tables.push({ file, rows });
      rowCount += rows;
    }

    // Utilisateurs membres (User n'a pas d'organizationId) : identité seulement, jamais d'empreinte.
    const memberships = await tenantDb.membership.findMany({ select: { userId: true } });
    const users = await adminDb.user.findMany({
      where: { id: { in: memberships.map((m) => m.userId) } },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
      orderBy: { id: "asc" },
    });
    const userColumns = ["id", "name", "email", "phone", "createdAt"];
    files["user.csv"] = strToU8(csvHeader(userColumns) + csvRows(userColumns, users));
    tables.push({ file: "user.csv", rows: users.length });
    rowCount += users.length;

    let photoCount = 0;
    const attachments = await tenantDb.attachment.findMany({ orderBy: { id: "asc" } });
    for (const attachment of attachments) {
      if (attachment.organizationId !== organizationId) continue;
      try {
        const bytes = await deps.storage.getObjectBytes(attachment.url);
        const ext = EXTENSIONS[attachment.mimeType] ?? "bin";
        files[`photos/${attachment.entity}-${safeName(attachment.id)}.${ext}`] = [
          bytes,
          { level: 0 },
        ];
        photoCount += 1;
      } catch (error) {
        logger.warn(
          { organizationId, attachmentId: attachment.id, error: (error as Error).message },
          "org.export : pièce jointe illisible, ignorée",
        );
      }
    }

    let documentCount = 0;
    if (deps.renderInvoicePdf) {
      const garage: InvoicePdfGarage = org;
      const invoices = await tenantDb.invoice.findMany({
        where: { number: { not: null }, status: { not: "DRAFT" } },
        orderBy: { number: "asc" },
      });
      for (const invoice of invoices as Invoice[]) {
        const pdfData = await tenantDb.transaction((tx) =>
          buildInvoicePdfData(tx, garage, invoice, (key) => deps.storage.getObjectBytes(key)),
        );
        files[`documents/${safeName(invoice.number!)}.pdf`] = [
          await deps.renderInvoicePdf(pdfData),
          { level: 0 },
        ];
        documentCount += 1;
      }
    }

    const now = clock.now();
    files["LISEZMOI.txt"] = strToU8(
      exportReadme({
        organizationName: org.name,
        generatedAt: formatDate(now, org.timezone),
        tables,
        photoCount,
        documentCount,
      }),
    );

    const archive = zipSync(files, { level: 6 });
    const key = `exports/${organizationId}/${exportId}.zip`;
    await deps.storage.upload({
      key,
      body: archive,
      contentType: "application/zip",
      maxBytes: MAX_ARCHIVE_BYTES,
    });

    await tenantDb.dataExport.update({
      where: { id: exportId },
      data: {
        status: "READY",
        fileUrl: key,
        sizeBytes: archive.byteLength,
        tableCount: tables.length,
        rowCount,
        completedAt: now,
        expiresAt: exportExpiry(now),
      },
    });

    const row = await tenantDb.dataExport.findUniqueOrThrow({ where: { id: exportId } });
    await tenantDb.notification.create({
      data: {
        organizationId,
        membershipId: row.requestedById,
        type: "export.ready",
        title: "Votre export de données est prêt",
        body: `Archive téléchargeable pendant 48 h (jusqu'au ${formatDate(exportExpiry(now), org.timezone)}).`,
        link: "/parametres/donnees",
        severity: "info",
        dedupeKey: `export.ready:${exportId}`,
      },
    });
    logger.info(
      { organizationId, exportId, sizeBytes: archive.byteLength },
      "org.export : archive prête",
    );
  } catch (error) {
    logger.error(
      { organizationId, exportId, error: (error as Error).message },
      "org.export : échec de la préparation de l'archive",
    );
    await tenantDb.dataExport.update({
      where: { id: exportId },
      data: {
        status: "FAILED",
        error:
          "La préparation de l'archive a échoué. Relancez l'export ; si l'erreur persiste, contactez le support.",
      },
    });
  }
}

const STALE_PENDING_MS = 2 * 60_000;
const STUCK_RUNNING_MS = 60 * 60_000;

/**
 * Balayage `exports.sweep` : reprend les exports restés PENDING (Redis indisponible lors de la
 * demande) et marque FAILED ceux bloqués en RUNNING (worker arrêté en cours de route).
 */
export async function processExportsSweep(deps: OrgExportDeps): Promise<number> {
  const now = (deps.clock ?? systemClock).now();
  const organizations = await adminDb.organization.findMany({ select: { id: true } });
  let processed = 0;
  for (const org of organizations) {
    const tx = db.forTenant({ organizationId: org.id });
    await tx.dataExport.updateMany({
      where: { status: "RUNNING", createdAt: { lt: new Date(now.getTime() - STUCK_RUNNING_MS) } },
      data: {
        status: "FAILED",
        error: "La préparation de l'archive a été interrompue. Relancez l'export.",
      },
    });
    const pending = await tx.dataExport.findMany({
      where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - STALE_PENDING_MS) } },
      select: { id: true },
    });
    for (const row of pending) {
      await runOrgExport({ organizationId: org.id, exportId: row.id }, deps);
      processed += 1;
    }
  }
  return processed;
}
