import { consola } from "consola";
import { PluginError } from "./types";
import type { PluginLogger } from "./types";

/** Matches a hostname against an allowlist entry. Supports "*.domain.com" wildcards and bare "*" for allow-all. */
export function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const lower = hostname.toLowerCase();
  for (const entry of allowedHosts) {
    const e = entry.toLowerCase();
    if (e === "*") return true;
    if (e === lower) return true;
    if (e.startsWith("*.")) {
      const suffix = e.slice(1);
      if (lower.endsWith(suffix) && lower.length > suffix.length) return true;
    }
  }
  return false;
}

/** Simple token-bucket rate limiter shared per plugin id. */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(
    public readonly capacity: number,
    public readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  take(n = 1): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = now;
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

const buckets = new Map<string, TokenBucket>();

export function getBucket(pluginId: string, capacity = 30, refillPerSecond = 5): TokenBucket {
  let bucket = buckets.get(pluginId);
  if (!bucket) {
    bucket = new TokenBucket(capacity, refillPerSecond);
    buckets.set(pluginId, bucket);
  }
  return bucket;
}

/**
 * Builds a fetch function bound to a plugin's allowlist and rate limiter.
 *
 * The allowlist is the union of the plugin's static `manifest.allowedHosts`
 * (passed as `allowedHosts`) and any dynamic hosts resolved per-invocation
 * from the plugin's `userConfig` or shared-credential entry via the
 * `x-allowed-host` JSON Schema extension (passed as `dynamicHosts`).
 *
 * `dynamicHosts` is optional so existing callers that do not resolve dynamic
 * hosts continue to work unchanged.
 */
export function buildFetch(
  pluginId: string,
  allowedHosts: string[],
  dynamicHosts?: ReadonlySet<string>,
) {
  const bucket = getBucket(pluginId);
  return async (url: string, init?: RequestInit): Promise<Response> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new PluginError("plugin.input_invalid", `[${pluginId}] invalid URL: ${url}`);
    }
    const hostname = parsed.hostname;
    const staticAllowed = isHostAllowed(hostname, allowedHosts);
    const dynamicAllowed = dynamicHosts ? dynamicHosts.has(hostname.toLowerCase()) : false;
    if (!staticAllowed && !dynamicAllowed) {
      throw new PluginError(
        "plugin.upstream_error",
        `[${pluginId}] host not in allowlist: ${hostname}`,
      );
    }
    if (!bucket.take()) {
      throw new PluginError("plugin.rate_limited", `[${pluginId}] rate limit exceeded`);
    }
    return fetch(url, init);
  };
}

export function buildLogger(pluginId: string): PluginLogger {
  const tag = `[plugin:${pluginId}]`;
  return {
    debug: (...args) => consola.debug(tag, ...args),
    info: (...args) => consola.info(tag, ...args),
    warn: (...args) => consola.warn(tag, ...args),
    error: (...args) => consola.error(tag, ...args),
  };
}
