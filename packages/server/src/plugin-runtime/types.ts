import type { z } from "zod";

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
  | { status: "error"; code: string; message: string };

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

/** Reserved error codes used to classify plugin failures at the host boundary. */
export const PLUGIN_ERROR_CODES = {
  AUTH_EXPIRED: "AUTH_EXPIRED",
  AUTH_INVALID: "AUTH_INVALID",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  DISABLED_HOST: "DISABLED_HOST",
} as const;

export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[keyof typeof PLUGIN_ERROR_CODES];

export class PluginError extends Error {
  constructor(
    public code: PluginErrorCode | string,
    message: string,
  ) {
    super(message);
    this.name = "PluginError";
  }
}

export interface CapabilitySpec<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  input: I;
  output: O;
}

export interface CapabilityDefinition {
  id: string;
  version: string;
  methods: Record<string, CapabilitySpec>;
}
