// Re-export from shared package where permission definitions live.
// Code-defined permission keys. Adding a new permission requires a code change because it must gate something.
export { PERMISSIONS, type Permission, ALL_PERMISSIONS } from "@ent-mcp/shared/auth";
