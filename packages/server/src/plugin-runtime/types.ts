import type { z } from "zod";
import type { JSONSchema, McpToolAnnotations, PluginManifest } from "@ent-mcp/shared";
import type { HostErrorCode } from "../errors/codes";

// ─── Server-only plugin runtime interfaces ────────────────────────────────────

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
  /**
   * Public-facing base URL of this deployment (e.g. `https://media.example.com`).
   * Sourced from `APP_EXTERNAL_URL`. Plugins use it to build OAuth redirect URIs
   * and outward-facing deep links (`playerLink`, `webLink`, etc.). No trailing
   * slash is guaranteed — callers that need one should append it themselves.
   */
  appBaseUrl: string;
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
  annotations?: McpToolAnnotations;
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
