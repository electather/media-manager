import type { JSONSchema } from "@ent-mcp/shared";
import { PluginError } from "@ent-mcp/plugin-sdk";
import { isNil } from "es-toolkit/predicate";

/**
 * Marker for the `x-allowed-host` JSON Schema extension. Plugins set this on
 * URL-valued `userConfigSchema` or `sharedCredentialsSchema` properties — the
 * resolved hostname is unioned into the per-invocation `ctx.fetch` allowlist
 * alongside the plugin's static `manifest.allowedHosts`.
 *
 * ⚠ Trust boundary: this is explicitly user-controlled. Any field marked
 * `x-allowed-host` allows the authenticated user to make `ctx.fetch` reach
 * the hostname they supplied — internal networks, RFC1918 ranges, anything
 * the upstream DNS resolves. Plugin authors must only apply the flag to
 * fields that represent the plugin's *own intended upstream* (the user's
 * Plex/Jellyfin server, a self-hosted mirror, etc.), never to generic proxy
 * targets or free-form URL inputs. `isBlockedHostname` below catches cloud
 * instance-metadata endpoints, loopback, link-local, and IPv4-mapped IPv6
 * loopback at resolution time (see the "SSRF mitigation" section of the
 * design doc); DNS-rebinding mitigation still has to happen at fetch time
 * and is tracked separately. The host boundary and intent check live with
 * the plugin author.
 */
const X_ALLOWED_HOST = "x-allowed-host";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

// Hostnames that must never enter the dynamic allowlist even when a plugin's
// `x-allowed-host` field resolves to them. See the "SSRF mitigation" section
// of `docs/2026-04-19-plugin-architecture-design.md` for the authoritative
// list and rationale. RFC1918 / ULA / `fc00::/7` ranges are deliberately
// NOT blocked — docker-compose and LAN deployments legitimately need them
// (a user's `internalServerUrl: http://plex:32400` is the whole point).
const BLOCKED_EXACT_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  // Cloud instance-metadata endpoints.
  "169.254.169.254", // AWS / GCP / Azure IMDS.
  "fd00:ec2::254", // AWS IMDSv6.
  "100.100.100.200", // Alibaba.
  // Unspecified and IPv6 loopback.
  "::1",
  "::",
  "0.0.0.0",
]);

// URL.hostname lowercases DNS names but returns IPv6 addresses wrapped in
// square brackets (`[::1]`). Strip the brackets so exact-match and prefix
// predicates can be written without worrying about the wrapping.
function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) return lower.slice(1, -1);
  return lower;
}

function isIpv4Loopback(hostname: string): boolean {
  // 127.0.0.0/8 — the entire loopback block, not just 127.0.0.1.
  return /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function isIpv4LinkLocal(hostname: string): boolean {
  // 169.254.0.0/16 — covers the AWS IMDS IP alongside the rest of the range.
  return /^169\.254(?:\.\d{1,3}){2}$/.test(hostname);
}

function isIpv6LinkLocal(hostname: string): boolean {
  // fe80::/10 — the first 10 bits are `1111 1110 10`, which means the leading
  // nibble is `f` and the second nibble is one of 8, 9, a, or b. Anything
  // starting with `fe8`, `fe9`, `fea`, or `feb` falls in range.
  return /^fe[89ab][0-9a-f]?:/.test(hostname);
}

function isIpv4MappedIpv6Loopback(hostname: string): boolean {
  // ::ffff:127.0.0.0/104 — loopback tunnelled through IPv4-mapped IPv6.
  return /^::ffff:127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Rejects hostnames that should never be reached from a plugin even when a
 * user-controlled `x-allowed-host` field resolves to them. Matches the string
 * only — DNS-rebinding mitigation (resolving the name and checking the actual
 * address) happens at fetch time and is out of scope for this module.
 */
export function isBlockedHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (BLOCKED_EXACT_HOSTNAMES.has(h)) return true;
  if (isIpv4Loopback(h)) return true;
  if (isIpv4LinkLocal(h)) return true;
  if (isIpv6LinkLocal(h)) return true;
  if (isIpv4MappedIpv6Loopback(h)) return true;
  return false;
}

/**
 * Extracts the hostname from an `x-allowed-host` value. Treats strings as URLs
 * (must include a protocol). Bare hostnames are rejected — we want the plugin
 * author to be explicit about the upstream they are reaching.
 *
 * Throws a typed `PluginError` with `plugin.input_invalid` so the runtime
 * surfaces the misconfiguration early (the plugin call fails fast instead of
 * silently losing the allowlist entry).
 */
// fallow-ignore-next-line complexity
function hostnameFromValue(pluginId: string, path: string, value: unknown): string {
  // Empty `path` can happen if a plugin declares `x-allowed-host` on the root
  // schema (unusual but valid JSON Schema); render it readably in errors so
  // the message does not end up with bare `''`.
  const displayPath = path || "(root)";
  // Each throw below attaches `params.field` per the error design doc's wire
  // convention so the frontend can attribute the error to the specific form
  // input without string-parsing the devMessage.
  //
  // The raw user-submitted `value` is *not* echoed into params: a URL of the
  // shape `http://user:password@host/` would round-trip the password through
  // the error body to the browser and into any sink that stores params.
  // `devMessage` still contains the URL for the admin viewer, which lives
  // behind authentication and passes through the scrubber.
  //
  // Omit `field` when the marker sits on the root schema — an empty string
  // would be a misleading hint for any downstream form that tried to route on
  // it.
  const fieldParams = (extra?: Record<string, string>): Record<string, string> => ({
    ...(path ? { field: path } : {}),
    ...extra,
  });
  if (typeof value !== "string" || value.length === 0) {
    throw new PluginError(
      "plugin.invalid_base_url",
      `[${pluginId}] x-allowed-host field '${displayPath}' must be a non-empty URL string`,
      fieldParams(),
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PluginError(
      "plugin.invalid_base_url",
      `[${pluginId}] x-allowed-host field '${displayPath}' is not a valid URL: ${value}`,
      fieldParams(),
    );
  }
  if (!parsed.hostname) {
    throw new PluginError(
      "plugin.invalid_base_url",
      `[${pluginId}] x-allowed-host field '${displayPath}' has no hostname: ${value}`,
      fieldParams(),
    );
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (isBlockedHostname(hostname)) {
    // `hostname` is the parsed output, not the raw input — safe to echo: it's
    // one of a small set of loopback/link-local strings (`localhost`,
    // `169.254.169.254`, etc.) that carry no credential material.
    throw new PluginError(
      "plugin.invalid_base_url",
      `[${pluginId}] x-allowed-host field '${displayPath}' resolves to a blocked address: ${hostname}`,
      fieldParams({ hostname }),
    );
  }
  return hostname;
}

/**
 * Walks a JSON Schema node in tandem with a config value, collecting hostnames
 * from any `x-allowed-host: true` properties found at or below this node. Only
 * descends into `properties` (objects) and `items` (arrays) — everything else
 * is treated as a leaf.
 */
// fallow-ignore-next-line complexity
function walk(
  pluginId: string,
  schema: unknown,
  value: unknown,
  path: string,
  out: Set<string>,
): void {
  const schemaObj = asRecord(schema);
  if (!schemaObj) return;

  if (schemaObj[X_ALLOWED_HOST] === true) {
    if (isNil(value) || value === "") return;
    out.add(hostnameFromValue(pluginId, path, value));
    // `x-allowed-host` is a leaf marker — don't recurse through the value.
    return;
  }

  const properties = asRecord(schemaObj.properties);
  if (properties) {
    const valueObj = asRecord(value);
    for (const [key, propSchema] of Object.entries(properties)) {
      const propValue = valueObj ? valueObj[key] : undefined;
      walk(pluginId, propSchema, propValue, path ? `${path}.${key}` : key, out);
    }
  }

  // `items` may be either a schema (uniform arrays) or an array of schemas
  // (tuple-style). Handle both so plugins that reach for either form still
  // get their `x-allowed-host` fields resolved instead of silently skipped.
  const itemsRaw = schemaObj.items;
  if (Array.isArray(itemsRaw) && Array.isArray(value)) {
    itemsRaw.forEach((tupleSchema, index) => {
      walk(pluginId, tupleSchema, (value as unknown[])[index], `${path}[${index}]`, out);
    });
  } else {
    const items = asRecord(itemsRaw);
    if (items && Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(pluginId, items, item, `${path}[${index}]`, out);
      });
    }
  }

  // Intentionally does not walk `allOf` / `oneOf` / `anyOf` — schema
  // composition is rare on credentials/config shapes and the extra recursion
  // is not worth the complexity. A plugin using composition keywords to
  // declare an `x-allowed-host` field would silently lose the allowlist
  // entry; authors that need it should hoist the flag to the outer schema.
}

/**
 * Given a JSON Schema and a matching config value, returns the set of
 * hostnames that should be unioned into the per-call `ctx.fetch` allowlist.
 * Returns an empty set if the schema is absent, the config is absent, or no
 * `x-allowed-host` fields were declared.
 *
 * Throws `PluginError("plugin.input_invalid")` if an `x-allowed-host` field
 * contains a malformed URL — callers should let this bubble so the user sees
 * a clear error on the offending plugin configuration.
 */
export function resolveAllowedHostsFromSchema(
  pluginId: string,
  schema: JSONSchema | undefined,
  value: unknown,
): Set<string> {
  const out = new Set<string>();
  if (!schema) return out;
  walk(pluginId, schema, value, "", out);
  return out;
}

/** Convenience: merges multiple host sets into one. */
export function unionHostSets(...sets: Array<ReadonlySet<string> | undefined>): Set<string> {
  const out = new Set<string>();
  for (const s of sets) {
    if (!s) continue;
    for (const h of s) out.add(h);
  }
  return out;
}
