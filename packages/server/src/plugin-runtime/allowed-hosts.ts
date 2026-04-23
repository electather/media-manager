import type { JSONSchema } from "@ent-mcp/shared";
import { PluginError } from "./types";

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
 * targets or free-form URL inputs. The runtime applies a narrow blocklist
 * to the resolved address (cloud metadata, localhost, IPv4-mapped IPv6
 * loopback — see the "SSRF mitigation" section of the design doc), but the
 * host boundary and intent check live with the plugin author.
 */
const X_ALLOWED_HOST = "x-allowed-host";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
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
function hostnameFromValue(pluginId: string, path: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PluginError(
      "plugin.input_invalid",
      `[${pluginId}] x-allowed-host field '${path}' must be a non-empty URL string`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PluginError(
      "plugin.input_invalid",
      `[${pluginId}] x-allowed-host field '${path}' is not a valid URL: ${value}`,
    );
  }
  if (!parsed.hostname) {
    throw new PluginError(
      "plugin.input_invalid",
      `[${pluginId}] x-allowed-host field '${path}' has no hostname: ${value}`,
    );
  }
  return parsed.hostname.toLowerCase();
}

/**
 * Walks a JSON Schema node in tandem with a config value, collecting hostnames
 * from any `x-allowed-host: true` properties found at or below this node. Only
 * descends into `properties` (objects) and `items` (arrays) — everything else
 * is treated as a leaf.
 */
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
    if (value === undefined || value === null || value === "") return;
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
