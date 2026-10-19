// M13 partie 2 — connexion directe, en lecture seule, à la base de l'ancien logiciel
// (RG-M13-25/26). Le code applicatif ne parle qu'à l'interface `ExternalDatabase` ;
// l'implémentation `memory` sert au local et aux tests (aucun compte réel requis).
// Firebird et Access passent par l'agent local (apps/sync-agent) ou un dossier surveillé.
import {
  bindSince,
  DomainError,
  SYNC_QUERY_MAX_ROWS,
  SYNC_QUERY_TIMEOUT_MS,
  type SqlDialect,
} from "@atelieros/core";
import mssql from "mssql";
import mysql from "mysql2/promise";
import pg from "pg";

export type ExternalDbType = SqlDialect | "memory";

export interface ExternalDbConfig {
  dbType: ExternalDbType;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export interface ExternalQueryResult {
  columns: string[];
  /** Valeurs déjà converties en texte (comme les cellules d'un fichier importé). */
  rows: string[][];
}

export interface ExternalTestResult {
  tables: number;
  /** RG-M13-25 : vrai si le compte a des droits d'écriture (« créez un compte en lecture seule »). */
  canWrite: boolean;
}

export interface ExternalDatabase {
  readonly dialect: ExternalDbType;
  test(): Promise<ExternalTestResult>;
  /** Exécute une requête déjà validée par `assertReadOnlySelect`, `:since` lié. */
  query(sql: string, since: Date, options?: { maxRows?: number }): Promise<ExternalQueryResult>;
  close(): Promise<void>;
}

/** Cellule SQL → texte normalisable par le pipeline d'import (dates en `aaaa-mm-jj` si minuit). */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function toResult(columns: string[], records: Record<string, unknown>[], maxRows: number) {
  if (records.length > maxRows) {
    throw new DomainError(
      "sync.too_many_rows",
      `La requête renvoie plus de ${maxRows} lignes : ajoutez un filtre :since.`,
    );
  }
  return { columns, rows: records.map((r) => columns.map((c) => cellToText(r[c]))) };
}

/**
 * Traduit les erreurs des pilotes en messages clairs, sans jamais reprendre le message brut
 * (qui peut contenir l'hôte ou l'utilisateur, M13 §11).
 */
export function friendlyExternalDbError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const e = error as { code?: string; number?: number; message?: string };
  const code = String(e.code ?? "");
  const message = String(e.message ?? "").toLowerCase();
  if (
    ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ESOCKET", "ETIMEOUT", "ETIMEDOUT"].includes(
      code,
    ) ||
    message.includes("getaddrinfo") ||
    message.includes("failed to connect")
  ) {
    return new DomainError(
      "sync.host_unreachable",
      "Hôte injoignable depuis internet : vérifiez l'adresse ou installez l'agent local.",
    );
  }
  if (
    ["28P01", "28000", "ER_ACCESS_DENIED_ERROR", "ELOGIN"].includes(code) ||
    message.includes("password authentication failed") ||
    message.includes("login failed")
  ) {
    return new DomainError("sync.auth_failed", "Identifiants refusés par la base.");
  }
  if (
    code === "57014" ||
    code === "PROTOCOL_SEQUENCE_TIMEOUT" ||
    code === "ETIMEOUT" ||
    message.includes("timeout")
  ) {
    return new DomainError(
      "sync.query_timeout",
      "La requête a dépassé 60 s : ajoutez un filtre :since.",
    );
  }
  if (
    ["42P01", "ER_NO_SUCH_TABLE", "EREQUEST"].includes(code) ||
    message.includes("does not exist")
  ) {
    return new DomainError(
      "sync.query_failed",
      "La base a refusé la requête : vérifiez les noms de tables et de colonnes.",
    );
  }
  return new DomainError("sync.unknown_error", "Erreur inattendue de la base externe.");
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw friendlyExternalDbError(error);
  }
}

function createPostgres(config: ExternalDbConfig): ExternalDatabase {
  const connect = async () => {
    const client = new pg.Client({
      host: config.host,
      port: config.port ?? 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 15_000,
      statement_timeout: SYNC_QUERY_TIMEOUT_MS,
    });
    await client.connect();
    return client;
  };
  return {
    dialect: "postgres",
    test: () =>
      guard(async () => {
        const client = await connect();
        try {
          const tables = await client.query(
            "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')",
          );
          // Toute session PostgreSQL peut créer une table temporaire : on vérifie donc les
          // droits réels (superutilisateur, ou INSERT/UPDATE/DELETE sur une table).
          const writable = await client.query(
            `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
                 OR EXISTS (
                   SELECT 1 FROM information_schema.tables t
                   WHERE t.table_schema NOT IN ('pg_catalog','information_schema')
                     AND has_table_privilege(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name),
                                             'INSERT,UPDATE,DELETE')
                 ) AS can_write`,
          );
          const canWrite = Boolean((writable.rows[0] as { can_write: boolean }).can_write);
          return { tables: (tables.rows[0] as { n: number }).n, canWrite };
        } finally {
          await client.end();
        }
      }),
    query: (sql, since, options) =>
      guard(async () => {
        const bound = bindSince(sql, "postgres");
        const client = await connect();
        try {
          // Double protection : transaction en lecture seule, quel que soit le compte fourni.
          await client.query("BEGIN READ ONLY");
          const res = await client.query(bound.sql, bound.occurrences > 0 ? [since] : []);
          await client.query("ROLLBACK");
          return toResult(
            res.fields.map((f) => f.name),
            res.rows as Record<string, unknown>[],
            options?.maxRows ?? SYNC_QUERY_MAX_ROWS,
          );
        } finally {
          await client.end();
        }
      }),
    close: async () => undefined,
  };
}

function createMysql(config: ExternalDbConfig): ExternalDatabase {
  const connect = () =>
    mysql.createConnection({
      host: config.host,
      port: config.port ?? 3306,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? {} : undefined,
      connectTimeout: 15_000,
      dateStrings: false,
    });
  return {
    dialect: "mysql",
    test: () =>
      guard(async () => {
        const conn = await connect();
        try {
          const [rows] = await conn.query(
            "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()",
          );
          const [grants] = await conn.query("SHOW GRANTS FOR CURRENT_USER()");
          const canWrite = (grants as Record<string, string>[]).some((g) =>
            /\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|DROP|ALTER)\b/i.test(Object.values(g)[0] ?? ""),
          );
          return { tables: Number((rows as { n: number }[])[0]?.n ?? 0), canWrite };
        } finally {
          await conn.end();
        }
      }),
    query: (sql, since, options) =>
      guard(async () => {
        const bound = bindSince(sql, "mysql");
        const conn = await connect();
        try {
          await conn.query("START TRANSACTION READ ONLY");
          const [rows, fields] = await conn.query({
            sql: bound.sql,
            values: Array.from({ length: bound.occurrences }, () => since),
            timeout: SYNC_QUERY_TIMEOUT_MS,
          });
          await conn.query("ROLLBACK");
          return toResult(
            (fields ?? []).map((f) => f.name),
            rows as Record<string, unknown>[],
            options?.maxRows ?? SYNC_QUERY_MAX_ROWS,
          );
        } finally {
          await conn.end();
        }
      }),
    close: async () => undefined,
  };
}

function createMssql(config: ExternalDbConfig): ExternalDatabase {
  const connect = () =>
    new mssql.ConnectionPool({
      server: config.host ?? "",
      port: config.port ?? 1433,
      database: config.database,
      user: config.user,
      password: config.password,
      options: { encrypt: config.ssl ?? false, trustServerCertificate: true },
      connectionTimeout: 15_000,
      requestTimeout: SYNC_QUERY_TIMEOUT_MS,
    }).connect();
  return {
    dialect: "mssql",
    test: () =>
      guard(async () => {
        const pool = await connect();
        try {
          const tables = await pool
            .request()
            .query<{ n: number }>("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES");
          const perms = await pool
            .request()
            .query<{ w: number }>(
              "SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') + HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') + HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS w",
            );
          const canWrite = (perms.recordset[0]?.w ?? 0) > 0;
          return { tables: tables.recordset[0]?.n ?? 0, canWrite };
        } finally {
          await pool.close();
        }
      }),
    query: (sql, since, options) =>
      guard(async () => {
        const bound = bindSince(sql, "mssql");
        const pool = await connect();
        try {
          const request = pool.request();
          if (bound.occurrences > 0) request.input("since", mssql.DateTime2, since);
          const res = await request.query<Record<string, unknown>>(bound.sql);
          const columns = Object.keys(res.recordset.columns ?? res.recordset[0] ?? {});
          return toResult(columns, res.recordset, options?.maxRows ?? SYNC_QUERY_MAX_ROWS);
        } finally {
          await pool.close();
        }
      }),
    close: async () => undefined,
  };
}

/** Résultats préparés par requête : implémentation locale/test, sans base réelle. */
export type MemoryQueryHandler = (sql: string, since: Date) => ExternalQueryResult;

export function createMemoryExternalDatabase(
  handler: MemoryQueryHandler,
  test: ExternalTestResult = { tables: 0, canWrite: false },
): ExternalDatabase {
  return {
    dialect: "memory",
    test: async () => test,
    query: async (sql, since, options) => {
      const result = handler(sql, since);
      if (result.rows.length > (options?.maxRows ?? SYNC_QUERY_MAX_ROWS)) {
        throw friendlyExternalDbError(
          new DomainError(
            "sync.too_many_rows",
            `La requête renvoie plus de ${options?.maxRows ?? SYNC_QUERY_MAX_ROWS} lignes : ajoutez un filtre :since.`,
          ),
        );
      }
      return result;
    },
    close: async () => undefined,
  };
}

export function createExternalDatabase(config: ExternalDbConfig): ExternalDatabase {
  switch (config.dbType) {
    case "postgres":
      return createPostgres(config);
    case "mysql":
      return createMysql(config);
    case "mssql":
      return createMssql(config);
    case "firebird":
      throw new DomainError(
        "sync.dialect_agent_only",
        "Firebird se synchronise via l'agent local installé sur le PC du garage.",
      );
    case "memory":
      // Sans résultats préparés : base vide (utile en développement local).
      return createMemoryExternalDatabase(() => ({ columns: [], rows: [] }));
  }
}
