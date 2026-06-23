// fallow-ignore-file complexity
// 6 branches all required by V2/V3/V4: URL parse, manifest check, admin check, dynamic host, rate limit, admin headers; each = distinct security gate; split → indirection ⊥ clarity gain
import { consola } from "consola";
import { captureError } from "../../diagnostics/capture";
import { PluginError } from "@nama/plugin-sdk";
import type { PluginLogger } from "@nama/plugin-sdk";
import { isNil } from "es-toolkit/predicate";
import { isBlockedHostname } from "./allowed-hosts";

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
 * Builds a fetch bound to the plugin's allowlist, rate limiter, and admin policy.
 * `adminAllowlist` narrows static hosts (`manifest.allowedHosts ∩ adminAllowlist`); `null` = manifest only;
 * dynamic `x-allowed-host` hosts bypass it. Admin-list blocks are audit-logged as `plugin.host_blocked_by_admin` (warning);
 * plugin sees `plugin.upstream_error`. `adminHeaders` override plugin headers via `Headers.set` (case-insensitive).
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
    // Hard SSRF reject before any allow decision: a static `manifest.allowedHosts`
    // entry (e.g. `localhost`, `169.254.169.254`, `metadata.google.internal`) must
    // not reach loopback/instance-metadata. Manifest can never opt out of the blocklist.
    if (isBlockedHostname(hostname)) {
      // The host may *be* in the allowlist (even `*`) yet still be rejected
      // here, so the devMessage names the real reason rather than reusing the
      // "not in allowlist" phrasing of the membership check below. The
      // plugin-facing `plugin.upstream_error` code is unchanged — plugins treat
      // it as a terminal call failure already (see the JSDoc above).
      throw new PluginError(
        "plugin.upstream_error",
        `[${pluginId}] host is blocked (loopback / link-local / metadata): ${hostname}`,
      );
    }
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
 * Prevents redirect-based SSRF: throws PluginError on any 3xx so an
 * attacker-controlled host cannot redirect to an internal endpoint (e.g. cloud instance-metadata).
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
