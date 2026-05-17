/**
 * Sentinel user id for global-scope jobs. Re-exported from the shared package
 * so server-infra (diagnostics sink) and catalog jobs share one source.
 */
export { SYSTEM_USER_ID } from "@ent-mcp/shared/jobs";
