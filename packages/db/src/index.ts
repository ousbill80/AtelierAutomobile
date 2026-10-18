export { adminDb } from "./client";
export {
  db,
  forTenant,
  MissingTenantContextError,
  TenantIsolationViolationError,
  type TenantContext,
} from "./tenant";
export * from "@prisma/client";
