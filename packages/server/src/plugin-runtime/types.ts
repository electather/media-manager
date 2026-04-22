import type { z } from "zod";
import type { HostErrorCode } from "../errors/codes";

/** JSON Schema subset used for plugin-supplied config shapes. Kept deliberately permissive. */
export type JSONSchema = Record<string, unknown>;

export type AuthKind = "form" | "oauth_redirect" | "oauth_device" | "none";

/** Scope a capability operates under. See docs/2026-04-19-plugin-architecture-design.md. */
export type CapabilityScope = "global" | "user";

/** One entry in `manifest.capabilities`. Scope governs credential routing. */
export interface ManifestCapability {
  version: string;
  scope: CapabilityScope;
}

export interface MCPToolAnnotations {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  readOnlyHint?: boolean;
}

/**
 * Declarative MCP tool record declared by either a capability definition or a
 * plugin manifest. The host prefixes plugin-declared tools with
 * `ext_<plugin_id>_` before registration.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  /** Name of the handler export on the plugin module's `mcpTools` object. */
  handler: string;
  annotations?: MCPToolAnnotations;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  author: { name: string; url?: string };
  homepage?: string;
  sdkVersion: string;
  allowedHosts: string[];

  /** Plaintext admin config (e.g. display settings, base URLs). */
  globalConfigSchema?: JSONSchema;
  /** Encrypted admin secrets — one schema, many pool entries for `poolable` plugins. */
  sharedCredentialsSchema?: JSONSchema;
  /** Plaintext user config. Rendered on connection forms. */
  userConfigSchema?: JSONSchema;
  /**
   * Encrypted user secrets. Required when any capability has `scope: "user"`
   * (validated at manifest install; see derived rules in the design doc).
   */
  credentialsSchema?: JSONSchema;

  auth: { kind: AuthKind };
  capabilities: Record<string, ManifestCapability>;

  /**
   * When true, the admin may configure multiple `shared_credentials` entries
   * and the host rotates across them on rate-limit. Non-poolable plugins
   * accept exactly one shared-credential entry.
   */
  poolable?: boolean;

  jobs?: Array<{
    id: string;
    schedule: string;
    handler: string;
    perConnection?: boolean;
  }>;

  /**
   * Optional plugin-contributed MCP tools. Registered as `ext_<plugin_id>_<name>`.
   * Capped at 5 per plugin; names and schemas validated at manifest load time.
   */
  mcpTools?: McpToolDefinition[];
}

export interface StoreScopeOpts {
  scope?: "user" | "global";
}

export interface StoreSetOpts extends StoreScopeOpts {
  ttlSec?: number;
}

export interface PluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface PluginStoreApi {
  get(key: string, opts?: StoreScopeOpts): Promise<unknown>;
  set(key: string, value: unknown, opts?: StoreSetOpts): Promise<void>;
  delete(key: string, opts?: StoreScopeOpts): Promise<void>;
}

export interface PoolSignalingApi {
  /**
   * Signals that the currently-injected credential (shared or user) is
   * rate-limited or temporarily unusable. Purely advisory: the host uses this
   * to update bookkeeping and rotate on the next retry attempt of the same
   * invocation.
   */
  markExhausted(opts?: { retryAfterSec?: number }): void;
}

export interface PluginContext<
  TCred = unknown,
  TSharedCred = unknown,
  TUserCfg = unknown,
  TGlobalCfg = unknown,
> {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  log: PluginLogger;
  /**
   * User secrets injected for user-scoped calls. `null` for global-scoped
   * calls (the plugin should fall back to `sharedCredentials` in that case).
   */
  credentials: TCred | null;
  /**
   * Admin-owned secrets. The host's current pick from the shared credentials
   * pool — may be `null` if the admin has configured none.
   */
  sharedCredentials: TSharedCred | null;
  config: { global: TGlobalCfg; user: TUserCfg };
  store: PluginStoreApi;
  pool: PoolSignalingApi;
}

/** Discriminated union returned by startAuth/completeAuth/pollAuth. */
export type AuthResult =
  | { status: "completed"; credentials: unknown }
  | { status: "redirect"; url: string; state: unknown }
  | {
      status: "display_code";
      code: string;
      verifyUrl: string;
      pollState: unknown;
      intervalSec: number;
      expiresAt: number;
    }
  | { status: "pending" }
  | { status: "error"; code: HostErrorCode; devMessage: string };

export type CapabilityMethod<I = unknown, O = unknown> = (
  ctx: PluginContext,
  input: I,
) => Promise<O>;

export type CapabilityImpl = Record<string, CapabilityMethod>;

export interface PluginJobHandler {
  (ctx: PluginContext): Promise<unknown>;
}

/**
 * Plugin-contributed MCP tool handler. Receives the same `PluginContext` that
 * capability methods receive, so the plugin can use `ctx.fetch`, `ctx.store`,
 * and `ctx.credentials` just like anywhere else.
 */
export type McpToolHandler<I = unknown, O = unknown> = (ctx: PluginContext, input: I) => Promise<O>;

export interface PluginModule {
  manifest: PluginManifest;
  startAuth?: (ctx: PluginContext, input: unknown) => Promise<AuthResult>;
  completeAuth?: (
    ctx: PluginContext,
    queryParams: Record<string, string>,
    state: unknown,
  ) => Promise<AuthResult>;
  pollAuth?: (ctx: PluginContext, pollState: unknown) => Promise<AuthResult>;
  refreshAuth?: (ctx: PluginContext, credentials: unknown) => Promise<unknown>;
  testConnection?: (ctx: PluginContext) => Promise<{ ok: boolean; message?: string }>;
  /**
   * Optional probe for pure-global plugins (auth.kind: "none") to verify a
   * specific shared-credential entry from the admin UI. Must not require a
   * user connection — only `ctx.sharedCredentials` is populated.
   */
  verifyShared?: (ctx: PluginContext) => Promise<{ ok: boolean; message?: string }>;
  capabilities: Record<string, CapabilityImpl>;
  jobs?: Record<string, PluginJobHandler>;
  /** Map of handler name → implementation, keyed by `manifest.mcpTools[].handler`. */
  mcpTools?: Record<string, McpToolHandler>;
}

export class PluginError extends Error {
  constructor(
    public code: HostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginError";
  }
}

/** The structural shape that the host recognizes as a plugin error. */
export interface PluginErrorShape {
  name: "PluginError";
  code: string;
  message: string;
}

/**
 * Duck-type guard for plugin errors. Intentionally does not use `instanceof` so
 * plugins loaded in a separate bundle (or without importing this class) still work
 * as long as they set `err.name = "PluginError"` and `err.code`.
 */
export function isPluginError(err: unknown): err is PluginErrorShape {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Error).name === "PluginError" &&
    typeof (err as PluginErrorShape).code === "string"
  );
}

export interface CapabilitySpec<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  input: I;
  output: O;
}

/** Capability method definition including optional per-method metadata. */
export interface CapabilityMethodSpec<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> extends CapabilitySpec<I, O> {
  /**
   * Cache prefixes (e.g. `"watchHistory@v1"`) to invalidate on a successful call.
   * Only meaningful for mutating methods.
   */
  invalidates?: string[];
}

/** Dispatch strategy. See `docs/media-service.md` §capability-strategies. */
export type CapabilityStrategy = "single" | "aggregate" | "primary_with_enrichment";

/** Capability-owned MCP tool — handler is a host-side function. */
export interface CapabilityMcpTool {
  /** Tool name as exposed to MCP clients. Must not start with `ext_`. */
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  requiredScopes: string[];
  annotations?: MCPToolAnnotations;
  /** Identifier resolved at registration time to a host module handler. */
  handlerKey: string;
}

export interface CapabilityDefinition {
  id: string;
  version: string;
  strategy: CapabilityStrategy;
  /** `true` when output depends on the caller's identity (cache key includes userId). */
  userScoped: boolean;
  /** Default positive-cache TTL applied when a call returns non-null. */
  defaultCacheTtlSec: number;
  /** TTL for null/empty results. Shorter to avoid pinning misses long-term. */
  negativeCacheTtlSec: number;
  /** Per-call timeout; treated as `transient_network` for retry/status. */
  defaultTimeoutMs: number;
  methods: Record<string, CapabilityMethodSpec>;
  /** Optional capability-owned MCP tools registered at host startup. */
  mcpTools?: CapabilityMcpTool[];
}
