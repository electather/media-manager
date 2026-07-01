import type { JSONSchema } from "@nama/shared";
import { PluginError } from "@nama/plugin-sdk";
import { isNil } from "es-toolkit/predicate";

/**
 * JSON Schema extension for dynamic `ctx.fetch` allowlisting. ⚠ User-controlled SSRF surface:
 * marked fields let the authenticated user direct `ctx.fetch` to an arbitrary hostname.
 * RFC1918/LAN permitted (Plex/Jellyfin); `isBlockedHostname` blocks loopback, link-local, IMDS, IPv4-mapped IPv6. DNS-rebinding deferred to fetch time.
 */
const X_ALLOWED_HOST = "x-allowed-host";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

// Hostnames blocked from the dynamic allowlist regardless of `x-allowed-host` resolution. See
// "SSRF mitigation" in `docs/2026-04-19-plugin-architecture-design.md`. RFC1918/ULA/`fc00::/7`
// are intentionally NOT blocked — LAN deployments need them (e.g. `http://plex:32400`).
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
// predicates can be written without worrying about the wrapping. Trailing
// dots are stripped too — `localhost.` is RFC-equivalent to `localhost` and
// must not slip past the exact-match blocklist (issue #448).
function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.+$/, "");
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

// Extracts the embedded IPv4 octets (`a.b.c.d`) from an IPv4-mapped IPv6 host. Returns null if
// not mapped. WHATWG URL (Node + Bun) canonicalises `::ffff:127.0.0.1` → `::ffff:7f00:1`; a
// dotted-only regex let `::ffff:169.254.169.254` slip past `isBlockedHostname`. Decodes both.
function ipv4MappedIpv6Embedded(hostname: string): string | null {
  // Expects a bracket-free hostname — every call site runs `normalizeHostname`
  // first, which strips the `[...]` IPv6 wrapping. A bracketed `[::ffff:...]`
  // would not match the prefix and return null.
  const prefix = "::ffff:";
  if (!hostname.startsWith(prefix)) return null;
  const rest = hostname.slice(prefix.length);
  // Dotted form: `::ffff:127.0.0.1` arrives verbatim.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rest)) return rest;
  // Hex form: `::ffff:7f00:1` → two 16-bit groups encoding the four octets.
  const match = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!match) return null;
  const high = Number.parseInt(match[1]!, 16);
  const low = Number.parseInt(match[2]!, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * Rejects blocked hostnames from `x-allowed-host` resolution. String-only check —
 * DNS-rebinding mitigation (resolve + re-check the actual address) is out of scope here; happens at fetch time.
 */
// fallow-ignore-next-line complexity
export function isBlockedHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (BLOCKED_EXACT_HOSTNAMES.has(h)) return true;
  if (isIpv4Loopback(h)) return true;
  if (isIpv4LinkLocal(h)) return true;
  if (isIpv6LinkLocal(h)) return true;
  // Re-run the full IPv4 blocklist against the address embedded in an
  // IPv4-mapped IPv6 host so the mapped form cannot smuggle loopback,
  // link-local, or an exact-listed address (e.g. `::ffff:0:0` → `0.0.0.0`)
  // past the same gates as a bare IPv4 address.
  const embedded = ipv4MappedIpv6Embedded(h);
  if (
    embedded &&
    (isIpv4Loopback(embedded) || isIpv4LinkLocal(embedded) || BLOCKED_EXACT_HOSTNAMES.has(embedded))
  ) {
    return true;
  }
  return false;
}

/**
 * Extracts the hostname from an `x-allowed-host` field value (must be a full URL — bare hostnames
 * rejected so authors are explicit about their upstream). Throws `PluginError("plugin.invalid_base_url")`
 * to fail fast and surface misconfiguration rather than silently dropping the allowlist entry.
 */
// fallow-ignore-next-line complexity
function hostnameFromValue(pluginId: string, path: string, value: unknown): string {
  // Empty `path` can happen if a plugin declares `x-allowed-host` on the root
  // schema (unusual but valid JSON Schema); render it readably in errors so
  // the message does not end up with bare `''`.
  const displayPath = path || "(root)";
  // `params.field` lets the frontend attribute the error without string-parsing devMessage.
  // Raw `value` is NOT echoed into params: `http://user:password@host/` would leak the password
  // through the error body; devMessage is safe (admin-only, scrubbed). `field` omitted on root
  // schema (empty path) — an empty string would mislead downstream form routing.
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

/** Walks schema+value collecting hostnames from `x-allowed-host: true` fields. Descends only into `properties` and `items`; everything else is a leaf. */
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
 * Returns hostnames to union into the per-call `ctx.fetch` allowlist by walking `schema`+`value`
 * for `x-allowed-host` fields. Returns an empty set if either is absent or no fields are marked.
 * Throws `PluginError("plugin.invalid_base_url")` on malformed URLs — let it bubble for clear UX.
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
