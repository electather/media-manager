// Barrel export for all Drizzle schema tables.
// Drizzle Kit and the db client both expect a single schema import.
// Each subdirectory owns the tables for one module; see
// docs/2026-05-20-backend-schema-namespaces-design.md.
export * from "./auth";
export * from "./catalog";
export * from "./home";
export * from "./infra";
export * from "./notifications";
export * from "./plugin-runtime";
export * from "./preferences";
export * from "./media";
