import { buildFetch, buildLogger } from "./fetch-policy";
import { buildStore } from "./host-bridge";
import type { PluginContext, PoolSignalingApi } from "./types";

export interface BuildContextArgs {
  pluginId: string;
  allowedHosts: string[];
  /**
   * Additional hostnames resolved per-invocation from `x-allowed-host` fields
   * in the plugin's `userConfigSchema` or `sharedCredentialsSchema`. Unioned
   * with `allowedHosts` before being passed to `buildFetch`. Optional so
   * call sites that don't have dynamic hosts (e.g. aux contexts for auth or
   * job handlers) keep working.
   */
  dynamicAllowedHosts?: ReadonlySet<string>;
  /**
   * Admin-set host allowlist. Intersected with `allowedHosts` inside
   * `buildFetch`. `null` / `undefined` means "inherit manifest" (no
   * narrowing). Applies only to the static side; `dynamicAllowedHosts` is
   * never filtered by admin policy.
   */
  adminAllowlist?: string[] | null;
  /**
   * Admin-set request headers merged into every `ctx.fetch` call. Admin
   * values override plugin-supplied headers on name collision.
   */
  adminHeaders?: Record<string, string>;
  userId: string | null;
  appBaseUrl: string;
  credentials?: unknown;
  sharedCredentials?: unknown;
  userConfig?: unknown;
  globalConfig?: unknown;
  pool?: PoolSignalingApi;
}

/** No-op pool signalling for contexts built outside an invocation (e.g. auth flows). */
const INERT_POOL: PoolSignalingApi = {
  markExhausted() {
    /* nothing to rotate outside of an invocation loop */
  },
};

/** Builds a fresh PluginContext per invocation. Nothing here is plugin-mutable. */
export function buildContext(args: BuildContextArgs): PluginContext {
  return {
    fetch: buildFetch(
      args.pluginId,
      args.allowedHosts,
      args.dynamicAllowedHosts,
      args.adminAllowlist ?? null,
      args.adminHeaders,
    ),
    log: buildLogger(args.pluginId),
    credentials: args.credentials ?? null,
    sharedCredentials: args.sharedCredentials ?? null,
    config: {
      global: args.globalConfig ?? null,
      user: args.userConfig ?? null,
    },
    store: buildStore(args.pluginId, args.userId),
    pool: args.pool ?? INERT_POOL,
    appBaseUrl: args.appBaseUrl,
  };
}
