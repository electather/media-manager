import type { z } from "zod";
import type { HostErrorCode } from "../errors/codes";

/** JSON Schema subset used for plugin-supplied config shapes. Kept deliberately permissive. */
export type JSONSchema = Record<string, unknown>;

export type AuthKind = "form" | "oauth_redirect" | "oauth_device" | "none";

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
  globalConfigSchema?: JSONSchema;
  userConfigSchema?: JSONSchema;
  credentialsSchema: JSONSchema;
  /**
   * When true, the admin may set shared credentials (from `credentialsSchema`) on the
   * plugin itself. Users without their own connection fall back to the shared credential.
   * Distinct from `globalConfigSchema`, which is for admin-only non-credential settings.
   */
  allowsSharedCredentials?: boolean;
  auth: { kind: AuthKind };
  capabilities: Record<string, string>;
  jobs?: Array<{
    id: string;
    schedule: string;
    handler: string;
    perConnection?: boolean;
  }>;
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

export interface PluginContext<TCred = unknown, TUserCfg = unknown, TGlobalCfg = unknown> {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  log: PluginLogger;
  credentials: TCred;
  config: { global: TGlobalCfg; user: TUserCfg };
  store: PluginStoreApi;
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
  capabilities: Record<string, CapabilityImpl>;
  jobs?: Record<string, PluginJobHandler>;
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
}
