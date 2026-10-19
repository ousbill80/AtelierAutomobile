import { Prisma, PrismaClient } from "@prisma/client";
import { adminDb } from "./client";

export interface TenantContext {
  organizationId: string;
}

export class MissingTenantContextError extends Error {
  constructor() {
    super(
      "Contexte multi-locataire manquant : organizationId requis pour toute requête applicative.",
    );
    this.name = "MissingTenantContextError";
  }
}

export class TenantIsolationViolationError extends Error {
  constructor() {
    super("Tentative d'accès à un enregistrement appartenant à une autre organisation.");
    this.name = "TenantIsolationViolationError";
  }
}

// Modèles portant organizationId : déterminé dynamiquement depuis le DMMF pour ne pas
// maintenir une liste à la main qui finirait par diverger du schema.prisma.
const TENANT_SCOPED_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "organizationId"))
    .map((model) => model.name),
);

// Modèles où organizationId est optionnel : catalogue partagé par la plateforme
// (organizationId null = global) complété par des ajouts propres à chaque organisation
// (RG-M02-20). Déterminé depuis le DMMF, comme TENANT_SCOPED_MODELS ci-dessus.
const GLOBAL_CATALOG_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) =>
      model.fields.some((field) => field.name === "organizationId" && !field.isRequired),
    )
    .map((model) => model.name),
);

const uncapitalize = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

function withOrganizationFilter(
  where: Record<string, unknown> | undefined,
  organizationId: string,
  includeGlobal: boolean,
) {
  const orgFilter = includeGlobal
    ? { OR: [{ organizationId }, { organizationId: null }] }
    : { organizationId };
  return { AND: [where ?? {}, orgFilter] };
}

type Args = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
};

type ModelDelegate = Record<string, (args: unknown) => Promise<unknown>>;

// Connexion dédiée au rôle Postgres restreint "atelieros_app" (sans BYPASSRLS), distincte
// de adminDb (rôle propriétaire "atelieros", superutilisateur Docker, réservé à l'infra).
// C'est sur cette connexion que la Row Level Security (01-architecture-technique.md §3)
// s'applique réellement : voir packages/db/prisma/migrations/*_enable_rls.
const globalForTenantDb = globalThis as unknown as { prismaApp?: PrismaClient };

const appDb =
  globalForTenantDb.prismaApp ??
  new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_APP_URL } },
  });

if (process.env.NODE_ENV !== "production") {
  globalForTenantDb.prismaApp = appDb;
}

type TxLike = Record<string, ModelDelegate>;

/**
 * Logique commune de filtrage par locataire, appliquée à un modèle/opération donnés sur une
 * connexion déjà positionnée (`set_config('app.organization_id', …)`) — factorisée pour être
 * utilisable aussi bien à l'intérieur de `forTenant()` (une transaction par appel) que de
 * `forTenant(ctx).transaction()` (plusieurs appels dans UNE même transaction, cf. RG-M02-08).
 */
async function executeTenantOperation(
  tx: TxLike,
  model: string,
  operation: string,
  args: unknown,
  organizationId: string,
): Promise<unknown> {
  if (!TENANT_SCOPED_MODELS.has(model)) {
    throw new Error(
      `db.forTenant() ne peut pas être utilisé sur le modèle "${model}" (non rattaché à une organisation).`,
    );
  }

  const typedArgs = (args ?? {}) as Args;
  const delegateName = uncapitalize(model);
  const delegate = tx[delegateName] as ModelDelegate;
  // Lecture seule : un catalogue global (VehicleMake/VehicleModel, RG-M02-20) inclut
  // les lignes organizationId=null en plus de celles de l'organisation. Les mutations
  // restent strictes : une organisation ne peut jamais modifier le catalogue global.
  const includeGlobalOnRead = GLOBAL_CATALOG_MODELS.has(model);

  switch (operation) {
    // findUnique(OrThrow) n'autorise pas de filtre composé dans `where` (sélecteur
    // unique strict) : on bascule sur findFirst(OrThrow) pour y ajouter organizationId.
    case "findUnique":
    case "findUniqueOrThrow": {
      const replacement = operation === "findUniqueOrThrow" ? "findFirstOrThrow" : "findFirst";
      return delegate[replacement]!({
        ...typedArgs,
        where: withOrganizationFilter(typedArgs.where, organizationId, includeGlobalOnRead),
      });
    }

    case "findFirst":
    case "findFirstOrThrow":
    case "findMany":
    case "count":
    case "aggregate":
    case "groupBy":
      return delegate[operation]!({
        ...typedArgs,
        where: withOrganizationFilter(typedArgs.where, organizationId, includeGlobalOnRead),
      });

    case "updateMany":
    case "updateManyAndReturn":
    case "deleteMany":
      return delegate[operation]!({
        ...typedArgs,
        where: withOrganizationFilter(typedArgs.where, organizationId, false),
      });

    // update/delete (singuliers) exigent eux aussi un sélecteur unique strict
    // (même contrainte que findUnique) : on vérifie d'abord l'appartenance via
    // findFirst filtré, puis on n'exécute l'opération réelle (avec le `where`
    // d'origine) que si l'enregistrement existe bien dans cette organisation.
    // Un catalogue global n'est jamais modifiable par une organisation : on exige
    // ici la correspondance exacte, pas includeGlobalOnRead.
    case "update":
    case "delete": {
      const existing = await delegate.findFirst!({
        where: withOrganizationFilter(typedArgs.where, organizationId, false),
      });
      if (!existing) {
        throw new TenantIsolationViolationError();
      }
      return delegate[operation]!(typedArgs);
    }

    case "create":
      return delegate.create!({
        ...typedArgs,
        data: { ...(typedArgs.data as Record<string, unknown>), organizationId },
      });

    case "createMany":
    case "createManyAndReturn":
      return delegate[operation]!({
        ...typedArgs,
        data: Array.isArray(typedArgs.data)
          ? typedArgs.data.map((row: Record<string, unknown>) => ({ ...row, organizationId }))
          : { ...(typedArgs.data as Record<string, unknown>), organizationId },
      });

    case "upsert": {
      // `where` d'un upsert doit rester un sélecteur unique tel quel (ex: id brut),
      // donc on ne peut pas y injecter organizationId sans risquer "record not found"
      // sur une création légitime. On vérifie donc explicitement avant d'agir : si
      // l'enregistrement existe déjà mais appartient à une autre organisation, on bloque.
      // Cette vérification doit passer par adminDb (hors RLS) : sur la connexion
      // restreinte, la policy RLS masquerait déjà la ligne d'une autre organisation,
      // ce qui ferait croire à tort que l'enregistrement n'existe nulle part et
      // laisserait passer un upsert vers la branche create (faux négatif de sécurité).
      const adminDelegate = (adminDb as unknown as Record<string, ModelDelegate>)[delegateName]!;
      const existing = (await adminDelegate.findUnique!({ where: typedArgs.where })) as {
        organizationId?: string;
      } | null;
      if (existing && existing.organizationId !== organizationId) {
        throw new TenantIsolationViolationError();
      }
      return delegate.upsert!({
        ...typedArgs,
        create: { ...(typedArgs.create as Record<string, unknown>), organizationId },
      });
    }

    default:
      return delegate[operation]!(typedArgs);
  }
}

const TENANT_OPERATIONS = [
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
  "update",
  "delete",
  "create",
  "createMany",
  "createManyAndReturn",
  "upsert",
] as const;

/** Delegate exposé à l'intérieur de `forTenant(ctx).transaction()` pour un modèle donné. */
function scopedDelegate(tx: TxLike, model: string, organizationId: string): ModelDelegate {
  const delegate: ModelDelegate = {};
  for (const operation of TENANT_OPERATIONS) {
    delegate[operation] = (args: unknown) =>
      executeTenantOperation(tx, model, operation, args, organizationId);
  }
  return delegate;
}

// Les propriétés de PrismaClient portant déjà le nom de modèle en camelCase (customer,
// vehicle…) avec leurs délégués pleinement typés : le client renvoyé par transaction()
// garde cette richesse de types, alors que l'implémentation (le Proxy ci-dessous) ne fait
// que les router dynamiquement vers executeTenantOperation() au runtime.
type ModelDelegateKeys = {
  [K in keyof PrismaClient]: K extends `$${string}` ? never : K;
}[keyof PrismaClient];

export type ScopedTenantClient = Pick<PrismaClient, ModelDelegateKeys>;

/**
 * Client Prisma filtré par locataire. Toute requête applicative doit passer par
 * `db.forTenant(ctx)` (CLAUDE.md) : chaque opération reçoit automatiquement le filtre
 * organizationId, et toute tentative sans contexte lève MissingTenantContextError.
 *
 * Chaque opération sur un modèle tenant-scopé s'exécute dans une transaction qui
 * positionne d'abord `app.organization_id` (set_config) sur la connexion restreinte,
 * pour que la policy RLS Postgres fasse écho au filtrage applicatif.
 */
export function forTenant(ctx: TenantContext) {
  const { organizationId } = ctx;
  if (!organizationId) {
    throw new MissingTenantContextError();
  }

  const extended = adminDb.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args }) {
          if (!model) {
            throw new Error("db.forTenant() requiert un modèle Prisma connu.");
          }
          return appDb.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
            return executeTenantOperation(
              tx as unknown as TxLike,
              model,
              operation,
              args,
              organizationId,
            );
          });
        },
      },
    },
  });

  return Object.assign(extended, {
    /**
     * RG-M02-08 (fusion client/véhicule) et toute opération multi-tables qui doit rester
     * atomique : ouvre UNE transaction sur la connexion restreinte, y positionne
     * `app.organization_id` une seule fois, et expose aux modèles tenant-scopés le même
     * filtrage automatique que `db.forTenant(ctx)` (y compris pour le catalogue global en
     * lecture), mais via plusieurs appels partageant la même transaction Postgres.
     */
    async transaction<T>(
      callback: (scoped: ScopedTenantClient) => Promise<T>,
      options?: { timeout?: number; maxWait?: number },
    ): Promise<T> {
      return appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
        const txLike = tx as unknown as TxLike;
        const scoped = new Proxy({} as ScopedTenantClient, {
          get(_target, modelLowercase: string) {
            const model = Prisma.dmmf.datamodel.models.find(
              (m) => uncapitalize(m.name) === modelLowercase,
            )?.name;
            if (!model) {
              throw new Error(`Modèle Prisma inconnu : "${modelLowercase}".`);
            }
            return scopedDelegate(txLike, model, organizationId);
          },
        });
        return callback(scoped);
      }, options);
    },
  });
}

export const db = { forTenant };
