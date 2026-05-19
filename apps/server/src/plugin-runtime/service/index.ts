/**
 * Public service surface for `plugin-runtime/`. All exports flow through this
 * barrel so `plugin-runtime/index.ts` only needs to import from `./service`.
 */
export {
  pluginRuntime,
  PluginRuntime,
  setMcpLifecycleHooks,
  type InvokeArgs,
  type InvokeWithCredentialsArgs,
} from "./runtime";
export { capabilityRegistry, CapabilityRegistry, type RegistryEntry } from "../internal/registry";
export {
  registerBuiltin,
  listBuiltins,
  getBuiltin,
  loadPlugin,
  validatePluginModule,
  PluginError,
  type BuiltinSource,
  type LoadedPlugin,
} from "../internal/loader";
export { HOST_SDK_VERSION, isSdkCompatible, classifyScopes } from "../internal/manifest";
export {
  loadPluginPolicy,
  setAdminAllowlist,
  updateAdminHeaders,
  invalidatePluginPolicy,
  type PluginAdminPolicy,
} from "../internal/admin-policy";
export {
  buildStore,
  sweepExpiredStore,
  isHostAllowed,
  TokenBucket,
  getBucket,
  buildFetch,
  buildLogger,
} from "../internal/host-bridge";
export {
  sharedCredentialsService,
  type SharedCredentialRow,
  type SharedCredentialSummary,
  type PoolPick,
} from "../internal/shared-credentials";
export {
  isBlockedHostname,
  resolveAllowedHostsFromSchema,
  unionHostSets,
} from "../internal/allowed-hosts";
export {
  getConnectionById,
  listEnabledConnectionsForUsers,
  ensureInboxConnection,
  type ConnectionRow,
} from "../internal/connections-access";
