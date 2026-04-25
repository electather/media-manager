// Host-internal plugin runtime exports. Plugin-author API lives in
// `@ent-mcp/plugin-sdk` — never re-export SDK symbols from this barrel.
export { HOST_SDK_VERSION, classifyScopes } from "./manifest";
export { capabilityRegistry } from "./registry";
export { pluginRuntime } from "./runtime";
export { registerBuiltin, listBuiltins, getBuiltin, loadPlugin } from "./loader";
export type { BuiltinSource, LoadedPlugin } from "./loader";
export { sweepExpiredStore } from "./host-bridge";
export { sharedCredentialsService } from "./shared-credentials";
export type {
  SharedCredentialSummary,
  PoolPick as SharedCredentialPick,
} from "./shared-credentials";
