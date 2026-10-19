// Catalogue des permissions et matrice par défaut (M01 §10). OWNER n'apparaît jamais
// comme clé de DEFAULT_ROLE_PERMISSIONS : resolvePermissions lui accorde tout le catalogue
// par construction (RG-M01-08), indépendamment de cette table.

export const ROLES = [
  "OWNER",
  "MANAGER",
  "ADVISOR",
  "MECHANIC",
  "STOREKEEPER",
  "CASHIER",
  "ACCOUNTANT",
] as const;
export type Role = (typeof ROLES)[number];

type NonOwnerRole = Exclude<Role, "OWNER">;

export const PERMISSIONS = [
  // Organisation (M01/M15)
  "org:read",
  "org:update",
  "site:manage",
  "member:read",
  "member:invite",
  "member:update",
  "member:deactivate",
  "role:manage",
  "audit:read",
  "settings:read",
  "settings:update",
  "settings:channels",
  "settings:payments",
  "settings:fne",
  "settings:billing",
  // Clients / véhicules (M02)
  "customer:read",
  "customer:create",
  "customer:update",
  "customer:delete",
  "customer:merge",
  "customer:export",
  "customer:consent",
  "customer:credit",
  "vehicle:read",
  "vehicle:create",
  "vehicle:update",
  "vehicle:delete",
  "vehicle:transfer",
  "vehicle:mileage_correct",
  // RDV (M03)
  "appointment:read",
  "appointment:create",
  "appointment:update",
  "appointment:cancel",
  "planning:manage",
  // OR (M04)
  "repair_order:read",
  "repair_order:create",
  "repair_order:update",
  "repair_order:assign",
  "repair_order:qc",
  "repair_order:deliver",
  "repair_order:deliver_unpaid",
  "repair_order:cancel",
  "repair_order:reopen",
  "repair_order:warranty_decide",
  "inspection:perform",
  "inspection:template_manage",
  // Devis (M05)
  "quote:read",
  "quote:create",
  "quote:update",
  "quote:send",
  "quote:record_decision",
  "quote:discount_override",
  "quote:delete",
  "labor_catalog:manage",
  // Atelier (M06)
  "task:read_own",
  "task:read_all",
  "time:clock",
  "time:edit",
  "attendance:manage",
  // Stock (M07)
  "stock:read",
  "stock:issue",
  "stock:receive",
  "stock:adjust",
  "stock:transfer",
  "product:manage",
  "product:view_cost",
  "purchase:read",
  "purchase:create",
  "purchase:approve",
  "supplier:manage",
  // Facturation (M08)
  "invoice:read",
  "invoice:create",
  "invoice:issue",
  "invoice:void",
  "invoice:credit_note",
  "invoice:price_below_min",
  "payment:read",
  "payment:create",
  "payment:refund",
  "cash:operate",
  "cash:close",
  "cash:expense",
  // Créances (M09)
  "receivable:read",
  "receivable:manage",
  "receivable:writeoff",
  "receivable:dispute",
  // Relances / messages (M10, M11)
  "reminder:read",
  "reminder:approve",
  "reminder:rules_manage",
  "message:read",
  "message:send",
  "message:assign",
  "message:history",
  "template:manage",
  "template:submit",
  "optout:manage",
  // Pilotage (M12)
  "report:read",
  "report:financial",
  "dashboard:owner",
  // Intégrations (M13)
  "import:run",
  "integration:manage",
  // Assurances (M16)
  "insurance:read",
  "insurance:manage",
  // IA (M17)
  "ai:use",
  "ai:configure",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isKnownPermission(permission: string): permission is Permission {
  return PERMISSION_SET.has(permission);
}

// Transcription directe de la matrice M01 §10.2 : permission -> rôles non-OWNER qui
// l'ont par défaut. Inversée en DEFAULT_ROLE_PERMISSIONS ci-dessous.
const GRANTS: ReadonlyArray<readonly [Permission, readonly NonOwnerRole[]]> = [
  ["org:read", ["MANAGER", "ADVISOR", "ACCOUNTANT"]],
  ["settings:read", ["MANAGER", "ADVISOR", "ACCOUNTANT"]],
  ["member:read", ["MANAGER", "ADVISOR", "ACCOUNTANT"]],
  ["member:invite", ["MANAGER"]],
  ["member:update", ["MANAGER"]],
  ["audit:read", ["MANAGER", "ACCOUNTANT"]],
  ["customer:read", ["MANAGER", "ADVISOR", "MECHANIC", "STOREKEEPER", "CASHIER", "ACCOUNTANT"]],
  ["customer:create", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["customer:update", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["customer:delete", ["MANAGER"]],
  ["customer:merge", ["MANAGER"]],
  ["customer:export", ["ACCOUNTANT"]],
  ["customer:consent", ["MANAGER", "ADVISOR"]],
  ["customer:credit", ["ACCOUNTANT"]],
  ["vehicle:read", ["MANAGER", "ADVISOR", "MECHANIC", "STOREKEEPER", "CASHIER", "ACCOUNTANT"]],
  ["vehicle:create", ["MANAGER", "ADVISOR"]],
  ["vehicle:update", ["MANAGER", "ADVISOR"]],
  ["vehicle:delete", ["MANAGER"]],
  ["vehicle:transfer", ["MANAGER"]],
  ["vehicle:mileage_correct", ["MANAGER"]],
  ["appointment:read", ["MANAGER", "ADVISOR", "MECHANIC", "CASHIER"]],
  ["appointment:create", ["MANAGER", "ADVISOR"]],
  ["appointment:update", ["MANAGER", "ADVISOR"]],
  ["appointment:cancel", ["MANAGER", "ADVISOR"]],
  ["planning:manage", ["MANAGER"]],
  ["repair_order:read", ["MANAGER", "ADVISOR", "MECHANIC", "STOREKEEPER", "CASHIER", "ACCOUNTANT"]],
  ["repair_order:create", ["MANAGER", "ADVISOR"]],
  ["repair_order:update", ["MANAGER", "ADVISOR"]],
  ["repair_order:assign", ["MANAGER"]],
  ["repair_order:qc", ["MANAGER"]],
  ["repair_order:cancel", ["MANAGER"]],
  ["repair_order:reopen", ["MANAGER"]],
  ["repair_order:warranty_decide", ["MANAGER"]],
  ["repair_order:deliver", ["MANAGER", "ADVISOR", "CASHIER"]],
  ["inspection:perform", ["MANAGER", "ADVISOR", "MECHANIC"]],
  ["inspection:template_manage", ["MANAGER"]],
  ["quote:read", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["quote:create", ["MANAGER", "ADVISOR"]],
  ["quote:update", ["MANAGER", "ADVISOR"]],
  ["quote:send", ["MANAGER", "ADVISOR"]],
  ["quote:record_decision", ["MANAGER", "ADVISOR"]],
  ["quote:discount_override", ["MANAGER"]],
  ["quote:delete", ["MANAGER"]],
  ["labor_catalog:manage", ["MANAGER"]],
  ["task:read_own", ["MANAGER", "MECHANIC"]],
  ["time:clock", ["MANAGER", "MECHANIC"]],
  ["task:read_all", ["MANAGER"]],
  ["time:edit", ["MANAGER"]],
  ["attendance:manage", ["MANAGER"]],
  ["stock:read", ["MANAGER", "ADVISOR", "MECHANIC", "STOREKEEPER", "ACCOUNTANT"]],
  ["stock:issue", ["MANAGER", "STOREKEEPER"]],
  ["stock:receive", ["MANAGER", "STOREKEEPER"]],
  ["stock:transfer", ["MANAGER", "STOREKEEPER"]],
  ["purchase:read", ["MANAGER", "STOREKEEPER"]],
  ["purchase:create", ["MANAGER", "STOREKEEPER"]],
  ["supplier:manage", ["MANAGER", "STOREKEEPER"]],
  ["stock:adjust", ["MANAGER"]],
  ["purchase:approve", ["MANAGER"]],
  ["product:manage", ["MANAGER", "STOREKEEPER"]],
  ["product:view_cost", ["MANAGER", "STOREKEEPER", "ACCOUNTANT"]],
  ["invoice:read", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["payment:read", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["invoice:create", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["invoice:issue", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["invoice:credit_note", ["ACCOUNTANT"]],
  ["payment:create", ["MANAGER", "CASHIER"]],
  ["cash:operate", ["MANAGER", "CASHIER"]],
  ["cash:close", ["MANAGER", "CASHIER"]],
  ["cash:expense", ["MANAGER", "CASHIER"]],
  ["receivable:read", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["receivable:manage", ["MANAGER", "ADVISOR", "ACCOUNTANT"]],
  ["receivable:dispute", ["MANAGER", "ACCOUNTANT"]],
  ["reminder:read", ["MANAGER", "ADVISOR", "ACCOUNTANT"]],
  ["reminder:approve", ["MANAGER", "ADVISOR", "ACCOUNTANT"]],
  ["reminder:rules_manage", ["MANAGER"]],
  ["template:manage", ["MANAGER"]],
  ["template:submit", ["MANAGER"]],
  ["optout:manage", ["MANAGER"]],
  ["message:read", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["message:send", ["MANAGER", "ADVISOR", "CASHIER", "ACCOUNTANT"]],
  ["message:assign", ["MANAGER", "ADVISOR"]],
  ["message:history", ["MANAGER", "ADVISOR", "ACCOUNTANT"]],
  ["report:read", ["MANAGER", "ACCOUNTANT"]],
  ["report:financial", ["ACCOUNTANT"]],
  ["import:run", ["MANAGER", "ACCOUNTANT"]],
  ["insurance:read", ["MANAGER", "ADVISOR", "ACCOUNTANT"]],
  ["insurance:manage", ["MANAGER", "ADVISOR"]],
  ["ai:use", ["MANAGER", "ADVISOR", "MECHANIC", "STOREKEEPER", "CASHIER", "ACCOUNTANT"]],
  // Permissions sans octroi par défaut à aucun rôle non-OWNER (restent ci-dessous pour
  // mémoire, utile pour vérifier l'exhaustivité du catalogue dans les tests) :
  // org:update, site:manage, member:deactivate, role:manage, settings:update,
  // settings:channels, settings:payments, settings:fne, settings:billing,
  // repair_order:deliver_unpaid, invoice:void, invoice:price_below_min, payment:refund,
  // receivable:writeoff, dashboard:owner, integration:manage, ai:configure.
];

function buildDefaultRolePermissions(): Record<NonOwnerRole, Permission[]> {
  const table: Record<NonOwnerRole, Permission[]> = {
    MANAGER: [],
    ADVISOR: [],
    MECHANIC: [],
    STOREKEEPER: [],
    CASHIER: [],
    ACCOUNTANT: [],
  };
  for (const [permission, roles] of GRANTS) {
    for (const role of roles) {
      table[role].push(permission);
    }
  }
  return table;
}

/** Matrice par défaut rôle → permissions (M01 §10.2). OWNER n'y figure pas : voir resolvePermissions. */
export const DEFAULT_ROLE_PERMISSIONS: Record<NonOwnerRole, readonly Permission[]> =
  buildDefaultRolePermissions();

export interface ResolvePermissionsInput {
  role: Role;
  /** Permissions de `RolePermission(org, role)` si l'organisation a surchargé la matrice par défaut. */
  organizationRolePermissions?: readonly string[];
  /** `Membership.permissions` : "module:action" (ajout) ou "!module:action" (retrait). */
  membershipOverrides?: readonly string[];
  /** Avertissements de permissions inconnues (RG-M01-08), poussés par effet de bord si fourni. */
  onUnknownPermission?: (permission: string) => void;
}

/** RG-M01-08 : résolution des permissions effectives d'une Membership. Fonction pure. */
export function resolvePermissions(input: ResolvePermissionsInput): Set<Permission> {
  const {
    role,
    organizationRolePermissions,
    membershipOverrides = [],
    onUnknownPermission,
  } = input;

  if (role === "OWNER") {
    return new Set(PERMISSIONS);
  }

  const base = organizationRolePermissions ?? DEFAULT_ROLE_PERMISSIONS[role];
  const effective = new Set<Permission>();
  for (const permission of base) {
    if (isKnownPermission(permission)) {
      effective.add(permission);
    } else {
      onUnknownPermission?.(permission);
    }
  }

  const grants = membershipOverrides.filter((p) => !p.startsWith("!"));
  const revokes = new Set(
    membershipOverrides.filter((p) => p.startsWith("!")).map((p) => p.slice(1)),
  );

  for (const permission of grants) {
    if (isKnownPermission(permission)) {
      effective.add(permission);
    } else {
      onUnknownPermission?.(permission);
    }
  }
  for (const permission of revokes) {
    effective.delete(permission as Permission);
  }

  return effective;
}

// RG-M01-12 : un MANAGER avec member:invite ne peut inviter que des rôles « inférieurs ».
const INVITABLE_BY_MANAGER: ReadonlySet<Role> = new Set([
  "MECHANIC",
  "STOREKEEPER",
  "CASHIER",
  "ADVISOR",
]);

/** RG-M01-12 : seul un OWNER invite OWNER, MANAGER, ACCOUNTANT ; un MANAGER invite le reste. */
export function canInviteRole(inviterRole: Role, targetRole: Role): boolean {
  if (inviterRole === "OWNER") {
    return true;
  }
  if (inviterRole === "MANAGER") {
    return INVITABLE_BY_MANAGER.has(targetRole);
  }
  return false;
}
