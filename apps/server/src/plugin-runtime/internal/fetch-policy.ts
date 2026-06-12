// fallow-ignore-file complexity
// 6 branches all required by V2/V3/V4: URL parse, manifest check, admin check, dynamic host, rate limit, admin headers; each = distinct security gate; split → indirection ⊥ clarity gain
import { consola } from "consola";
import { captureError } from "../../diagnostics/capture";
import { PluginError } from "@ent-mcp/plugin-sdk";
import type { PluginLogger } from "@ent-mcp/plugin-sdk";
import { isNil } from "es-toolkit/predicate";

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
 * Builds a fetch function bound to a plugin's allowlist, rate limiter, and
 * admin policy.
 *
 * The allowlist is the union of the plugin's static `manifest.allowedHosts`
 * (`allowedHosts`) and any dynamic hosts resolved per-invocation from the
 * plugin's `userConfig` or shared-credential entry via `x-allowed-host`
 * (`dynamicHosts`). Admin policy layers on top:
 *
 * - `adminAllowlist` narrows the static side — the hostname must pass both
 *   `manifest.allowedHosts` AND `adminAllowlist`. `null` means the admin has
 *   not set a narrowing list (current behaviour; manifest-only). Dynamic
 *   `x-allowed-host` values are deliberately unaffected so user-supplied LAN
 *   server URLs remain reachable.
 * - `adminHeaders` are merged into the request after the allowlist check
 *   passes. Admin values override plugin-supplied headers on name collisions
 *   (`Headers.set` is case-insensitive, so admin-wins is uniform).
 *
 * When a call is rejected specifically because the admin list narrowed the
 * manifest, a `plugin.host_blocked_by_admin` error is captured at severity
 * `warning` so the admin errors dashboard carries the audit trail. The plugin
 * itself sees the pre-existing `plugin.upstream_error` — plugins treat that as
 * a terminal call failure already and do not need a new error shape.
 */
export function buildFetch(
  pluginId: string,
  allowedHosts: string[],
  dynamicHosts?: ReadonlySet<string>,
  adminAllowlist?: string[] | null,
  adminHeaders?: Record<string, string>,
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
    const inManifest = isHostAllowed(hostname, allowedHosts);
    const inAdmin = isNil(adminAllowlist) ? true : isHostAllowed(hostname, adminAllowlist);
    const staticAllowed = inManifest && inAdmin;
    // Strip trailing dots so `localhost.`-style hostnames compare against the
    // same canonical form the dynamic allowlist stores (issue #448).
    const dynamicAllowed = dynamicHosts
      ? dynamicHosts.has(hostname.toLowerCase().replace(/\.+$/, ""))
      : false;
    if (!staticAllowed && !dynamicAllowed) {
      if (inManifest && !inAdmin) {
        // Admin-imposed block: audit-log it before surfacing the existing
        // plugin-facing error. Fire-and-forget — a sink failure must not
        // prevent the fetch from rejecting.
        void captureError(new Error(`host blocked by admin allowlist: ${hostname}`), {
          severity: "warning",
          source: "plugin",
          code: "plugin.host_blocked_by_admin",
          pluginId,
          devMessage: `[${pluginId}] host blocked by admin allowlist: ${hostname}`,
          context: { hostname },
        });
      }
      throw new PluginError(
        "plugin.upstream_error",
        `[${pluginId}] host not in allowlist: ${hostname}`,
      );
    }
    if (!bucket.take()) {
      throw new PluginError("plugin.rate_limited", `[${pluginId}] rate limit exceeded`);
    }
    if (adminHeaders && Object.keys(adminHeaders).length > 0 && staticAllowed) {
      const merged = new Headers(init?.headers);
      for (const [name, value] of Object.entries(adminHeaders)) {
        merged.set(name, value);
      }
      return fetchNoRedirect(pluginId, url, { ...init, headers: merged });
    }
    return fetchNoRedirect(pluginId, url, init);
  };
}

/**
 * Wraps fetch with redirect: 'manual' and throws a PluginError if the
 * upstream returns a 3xx response. This prevents redirect-based SSRF where
 * an attacker-controlled host redirects the server to an internal endpoint
 * (e.g. the cloud instance-metadata service).
 */
async function fetchNoRedirect(
  pluginId: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new PluginError("plugin.upstream_error", `[${pluginId}] redirects are not permitted`);
  }
  return response;
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
