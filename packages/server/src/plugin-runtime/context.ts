import { buildFetch, buildLogger } from "./fetch-policy";
import { buildStore } from "./host-bridge";
import type { PluginContext, PoolSignalingApi } from "./types";

export interface BuildContextArgs {
  pluginId: string;
  allowedHosts: string[];
  userId: string | null;
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
    fetch: buildFetch(args.pluginId, args.allowedHosts),
    log: buildLogger(args.pluginId),
    credentials: args.credentials ?? null,
    sharedCredentials: args.sharedCredentials ?? null,
    config: {
      global: args.globalConfig ?? null,
      user: args.userConfig ?? null,
    },
    store: buildStore(args.pluginId, args.userId),
    pool: args.pool ?? INERT_POOL,
  };
}
