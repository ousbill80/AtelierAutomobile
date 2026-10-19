// Déplacé dans `@atelieros/db` (packages/db/src/audit.ts) pour être appelable
// depuis `@atelieros/import` (et donc depuis le worker BullMQ), pas seulement
// depuis apps/web. Ce fichier ne fait que ré-exporter pour ne pas casser les
// imports existants (`from "../audit"` / `from "./audit"`).
export { writeAuditLog } from "@atelieros/db";
export type { WriteAuditLogInput } from "@atelieros/db";
