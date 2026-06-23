import type { z } from "zod";
import type { JSONSchema, McpToolAnnotations, PluginManifest } from "@nama/shared";
import type { HostErrorCode } from "@nama/shared/diagnostics";
import type { NotificationEvent } from "@nama/shared/notifications";

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
   * Signals credential is rate-limited or temporarily unusable. The host uses
   * this to update bookkeeping and rotate on the next retry of the invocation.
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
   * The user this invocation runs on behalf of, or `null` for global-scoped
   * calls. Plugins use this for user-targeted notifications (e.g.
   * `connection.sync.succeeded` needs `audience.userId`).
   */
  userId: string | null;
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
   * Public-facing base URL (e.g. `https://media.example.com`). Normalized at
   * env-parse from `APP_EXTERNAL_URL`: scheme is `http(s)`, trailing slash
   * stripped. Safe to append `/path` for OAuth callbacks and deep links.
   */
  appBaseUrl: string;
  /**
   * Emit a pre-registered notification event. Host handles enrichment (id,
   * occurredAt), validation, and delivery. Only core-registry events; plugin-
   * declared types deferred to v2.
   */
  notify: (event: Omit<NotificationEvent, "id" | "occurredAt">) => Promise<void>;
}

/** Discriminated union returned by startAuth/completeAuth/pollAuth. */
export type AuthResult =
  | {
      status: "completed";
      credentials: unknown;
      /**
       * Optional patch merged into `userConfig` before write.
       * Avoids round-tripping server-resolved IDs (Plex `machineIdentifier`,
       * Jellyfin `userId` from `/Users/Me`) through client; set key to `null` to delete.
       */
      userConfigPatch?: Record<string, unknown>;
    }
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
  | {
      status: "error";
      code: HostErrorCode;
      devMessage: string;
      /**
       * Interpolation values per error design doc's wire format
       * (docs/2026-04-19-error-management-design.md §Wire format). Carries
       * `field` hint for frontend form-submission failures.
       */
      params?: Record<string, string | number>;
    };

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
  /**
   * Required when `manifest.auth.kind !== "none"`. Host invokes during
   * connection creation (and form-auth edits) to exchange `userConfig` for
   * encrypted `credentials`. Omit for `auth.kind: "none"`; host skips call.
   */
  startAuth?: (ctx: PluginContext, input: unknown) => Promise<AuthResult>;
  completeAuth?: (
    ctx: PluginContext,
    queryParams: Record<string, string>,
    state: unknown,
  ) => Promise<AuthResult>;
  pollAuth?: (ctx: PluginContext, pollState: unknown) => Promise<AuthResult>;
  refreshAuth?: (ctx: PluginContext, credentials: unknown) => Promise<unknown>;
  /**
   * Required when `manifest.auth.kind !== "none"`. For `auth.kind: "none"`
   * plugins the capability owns the probe (e.g. `notificationDelivery.testDelivery`),
   * so this module-level function is optional and typically omitted.
   */
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
   * Cache prefixes (e.g. `"watchHistory@v1"`) to invalidate on success.
   * Only meaningful for mutating methods.
   */
  invalidates?: string[];
  /**
   * When true, existing plugins can omit the implementation (dispatcher surfaces
   * `plugin.missing_method`). Used for home-feed extensions
   * (`watchHistory@v1.getInProgress`, `mediaRequest@v1.getStatusBatch`).
   */
  optional?: boolean;
}

/**
 * Dispatch strategy. Tagged union so variants can carry their own
 * configuration (e.g. `aggregate_per_kind`'s `perKindFields`). See
 * `docs/media-service.md` §capability-strategies.
 */
export type CapabilityStrategy =
  | { kind: "single" }
  | { kind: "aggregate" }
  | { kind: "primary_with_enrichment" }
  | { kind: "aggregate_per_kind"; perKindFields: readonly string[] };

/** Lookup helper — narrows a strategy variant by its discriminator. */
export type CapabilityStrategyKind = CapabilityStrategy["kind"];

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

/**
 * Scope a dispatched call is routed at: `"global"` (shared result, cache not
 * userId-qualified), `"user"` (per-caller result), or `"mixed"` (dispatcher
 * chooses per-request via `scopeForInput`).
 */
export type CapabilityScopeMode = "global" | "user" | "mixed";

/** The resolved scope a single dispatch request is executed under. */
export type ResolvedCapabilityScope = "global" | "user";

interface CapabilityDefinitionBase {
  id: string;
  version: string;
  strategy: CapabilityStrategy;
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

/**
 * Fixed-scope (`"global"` or `"user"`) uses same scope per call; `"mixed"` uses
 * per-request scope via pure `scopeForInput`. Cache keying is userId-qualified
 * only for `"user"` scope — user results never served from global cache.
 */
export type CapabilityDefinition = CapabilityDefinitionBase &
  (
    | { scope: "global" | "user"; scopeForInput?: never }
    | {
        scope: "mixed";
        scopeForInput: (input: unknown) => ResolvedCapabilityScope;
      }
  );
