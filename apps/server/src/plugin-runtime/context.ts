import { consola } from "consola";
import { buildFetch, buildLogger } from "./fetch-policy";
import { buildStore } from "./host-bridge";
import { emit as hostEmit } from "../notifications/emit";
import type { PluginContext, PoolSignalingApi } from "@ent-mcp/plugin-sdk";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";

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
  /**
   * Optional emit override; defaults to the host's `emit()`. Test contexts
   * supply a stub when they want to assert envelopes without persisting.
   */
  notify?: (event: Omit<NotificationEvent, "id" | "occurredAt">) => Promise<void>;
}

/** No-op pool signalling for contexts built outside an invocation (e.g. auth flows). */
const INERT_POOL: PoolSignalingApi = {
  markExhausted() {
    /* nothing to rotate outside of an invocation loop */
  },
};

/** Builds a fresh PluginContext per invocation. Nothing here is plugin-mutable. */
// fallow-ignore-next-line complexity
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
    userId: args.userId,
    credentials: args.credentials ?? null,
    sharedCredentials: args.sharedCredentials ?? null,
    config: {
      global: args.globalConfig ?? null,
      user: args.userConfig ?? null,
    },
    store: buildStore(args.pluginId, args.userId),
    pool: args.pool ?? INERT_POOL,
    appBaseUrl: args.appBaseUrl,
    notify: args.notify ?? buildHostNotify(args.pluginId),
  };
}

/**
 * Produces the default `ctx.notify` that funnels plugin-emitted events into
 * the host's `emit()`. Failures are logged via `consola` and never propagate
 * — a misbehaving notification path must not break the plugin's primary
 * operation.
 */
function buildHostNotify(
  pluginId: string,
): (event: Omit<NotificationEvent, "id" | "occurredAt">) => Promise<void> {
  return async (event) => {
    try {
      await hostEmit(event);
    } catch (err) {
      consola.error(`[plugin:${pluginId}] ctx.notify failed:`, err);
    }
  };
}
