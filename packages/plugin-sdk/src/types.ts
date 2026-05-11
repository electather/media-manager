import type { z } from "zod";
import type { JSONSchema, McpToolAnnotations, PluginManifest } from "@ent-mcp/shared";
import type { HostErrorCode } from "@ent-mcp/shared/diagnostics";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";

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
   * The user this invocation is running on behalf of, or `null` for
   * unauthenticated / global-scoped calls. Plugins use this when emitting
   * user-targeted notifications (e.g. `connection.sync.succeeded` from a
   * per-connection sync job needs the connection owner in `audience.userId`).
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
   * Public-facing base URL of this deployment (e.g. `https://media.example.com`).
   * Sourced from `APP_EXTERNAL_URL` and normalised at env-parse time: scheme
   * is guaranteed to be `http(s)`, and any trailing slash is stripped. Plugins
   * can safely append path segments with a leading `/` (e.g.
   * `${ctx.appBaseUrl}/oauth/callback`) when building OAuth redirect URIs and
   * outward-facing deep links.
   */
  appBaseUrl: string;
  /**
   * Emit a pre-registered notification event. The host handles enrichment
   * (id, occurredAt), validation, recipient resolution, and delivery.
   * Plugins can only emit events declared in the core registry — plugin-declared
   * event types are deferred to v2.
   */
  notify: (event: Omit<NotificationEvent, "id" | "occurredAt">) => Promise<void>;
}

/** Discriminated union returned by startAuth/completeAuth/pollAuth. */
export type AuthResult =
  | {
      status: "completed";
      credentials: unknown;
      /**
       * Optional patch merged into the submitted `userConfig` before the
       * `service_connections` row is written. Used by plugins that resolve
       * server-side identifiers during auth (e.g. Plex's `machineIdentifier`
       * and account id, Jellyfin's `userId` from `/Users/Me`) without
       * round-tripping through the client, or to strip submitted secrets
       * that the plugin has promoted into the encrypted `credentials` blob
       * (set the key to `null` to delete it from the persisted
       * `userConfig`). Built-in plugins are trusted to only set keys that
       * are either declared on `userConfigSchema` or explicitly cleared via
       * `null`; schema-level validation for user-installed plugins is
       * planned but not yet implemented.
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
       * Interpolation values and routing hints per the error design doc's
       * wire format (docs/2026-04-19-error-management-design.md §Wire
       * format). Used today to carry a `field` hint back to the frontend so
       * a form-submission failure can highlight the offending input.
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
   * Required when `manifest.auth.kind !== "none"`. The host invokes it during
   * connection creation (and re-runs it on form-auth edits) to exchange the
   * submitted `userConfig` for the persisted credentials blob. Omit for
   * `auth.kind: "none"` plugins — the host skips the call entirely and
   * persists the connection with empty credentials.
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
   * Cache prefixes (e.g. `"watchHistory@v1"`) to invalidate on a successful call.
   * Only meaningful for mutating methods.
   */
  invalidates?: string[];
  /**
   * When true, the host treats this method as a backward-compatible
   * addition: plugins that already implement the capability may omit the
   * implementation, and the dispatcher surfaces `plugin.missing_method`
   * which the aggregate strategy tolerates by skipping the contributor.
   * Used for the home-feed extensions to `watchHistory@v1.getInProgress`
   * and `mediaRequest@v1.getStatusBatch` so existing plugins keep loading.
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
 * The scope a dispatched call is routed at.
 *
 * - `"global"`: one shared result across all callers; cache key is not
 *   userId-qualified; providers register under the global scope.
 * - `"user"`: result depends on the caller; cache key is userId-qualified;
 *   providers register under the user scope.
 * - `"mixed"`: the capability accepts either — providers can register under
 *   either scope and the dispatcher chooses per-request from the input via
 *   `scopeForInput`. Required for capabilities like `idResolve@v1` where a
 *   `from: "tmdb"` input is global but a `from: "plex:ratingKey"` input
 *   must resolve against a user's own Plex server.
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
 * A dispatched capability is one of three shapes:
 *
 * - Fixed-scope (`"global"` or `"user"`): every call resolves to the same
 *   scope and `scopeForInput` is prohibited at the type level.
 * - `"mixed"`: the scope depends on the request, so `scopeForInput` is
 *   **required**. The classifier must be pure and side-effect free — the
 *   dispatcher calls it once per dispatch and threads the result through
 *   both provider lookup (`listProviders` is indexed by scope) and cache
 *   keying (the key is only userId-qualified when the resolved scope is
 *   `"user"`), so a user-scoped result can never be served from a global
 *   cache entry.
 */
export type CapabilityDefinition = CapabilityDefinitionBase &
  (
    | { scope: "global" | "user"; scopeForInput?: never }
    | {
        scope: "mixed";
        scopeForInput: (input: unknown) => ResolvedCapabilityScope;
      }
  );
