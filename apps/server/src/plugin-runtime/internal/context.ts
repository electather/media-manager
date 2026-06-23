import { randomUUID } from "node:crypto";
import { consola } from "consola";
import { buildFetch, buildLogger } from "./fetch-policy";
import { buildStore } from "./host-bridge";
import { emit } from "../../jobs/events";
import { PLUGIN_RUNTIME_EVENTS, notifyRequestedPayload } from "../events";
import type { PluginContext, PoolSignalingApi } from "@nama/plugin-sdk";
import type { NotificationEvent } from "@nama/shared/notifications";

export interface BuildContextArgs {
  pluginId: string;
  allowedHosts: string[];
  /**
   * Per-invocation hostnames from `x-allowed-host` fields in `userConfigSchema`/`sharedCredentialsSchema`.
   * Unioned with `allowedHosts` in `buildFetch`. Optional — auth/job aux contexts omit it.
   */
  dynamicAllowedHosts?: ReadonlySet<string>;
  /**
   * Admin-set host allowlist. Intersected with `allowedHosts` in `buildFetch`; `null`/`undefined` = inherit manifest.
   * Never filters `dynamicAllowedHosts` — user-supplied LAN URLs must stay reachable.
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
 * Default `ctx.notify`: wraps the plugin's partial event into a full `NotificationEvent`
 * (host-generated `id` + `occurredAt`) and emits `plugin-runtime.notify.requested`.
 * Failures are swallowed — a broken notification path must not break the plugin's primary return.
 */
function buildHostNotify(
  pluginId: string,
): (event: Omit<NotificationEvent, "id" | "occurredAt">) => Promise<void> {
  return async (event) => {
    const fullEvent = {
      ...event,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
    } as NotificationEvent;
    try {
      await emit(PLUGIN_RUNTIME_EVENTS.NOTIFY_REQUESTED, notifyRequestedPayload, {
        pluginId,
        event: fullEvent,
      });
    } catch (err) {
      consola.error(`[plugin:${pluginId}] ctx.notify failed:`, err);
    }
  };
}
