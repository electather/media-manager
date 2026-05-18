import { and, eq, ne, notExists } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections } from "../db/schema";
import { env } from "../env";
import { encrypt, decrypt } from "../crypto/vault";
import { internal } from "../diagnostics/http-errors";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { invalidateUserCache } from "../media";
import { isNil } from "es-toolkit/predicate";

function split(combined: string): { iv: string; data: string } {
  const [iv, ...rest] = combined.split(":");
  if (!iv || rest.length === 0) throw internal("http.internal_error", "invalid ciphertext");
  return { iv, data: rest.join(":") };
}

export async function encryptJson(value: unknown): Promise<{ iv: string; data: string }> {
  const combined = await encrypt(JSON.stringify(value), env.ENCRYPTION_KEY);
  return split(combined);
}

export async function decryptJson(iv: string | null, data: string | null): Promise<unknown> {
  if (!iv || !data) return null;
  const plain = await decrypt(`${iv}:${data}`, env.ENCRYPTION_KEY);
  try {
    return JSON.parse(plain);
  } catch {
    return plain;
  }
}

/**
 * Extension keys on a JSON Schema property that mark a field as
 * "do not return to the client" for one reason or another:
 *  - `x-secret` — encrypted at rest, never returned (credentials-like).
 *  - `x-private` — stored plaintext, never returned (internal-only).
 * A field may carry both; stripping is idempotent.
 */
export const RESPONSE_STRIPPED_EXTENSIONS = ["x-secret", "x-private"] as const;

/**
 * Extension marker for `userConfig` fields whose value is resolved and owned
 * by the plugin — the user never submits one through the form. Incoming
 * payloads that contain a value for a field carrying `"x-plugin-resolved":
 * true` have that key stripped before the payload reaches the plugin's
 * `startAuth` or the persisted row. The plugin repopulates the field via
 * `userConfigPatch` (e.g. Jellyfin resolving the caller's `userId` from
 * `/Users/Me`); a hostile client cannot impersonate another account by
 * spoofing the value.
 */
export const REQUEST_STRIPPED_EXTENSIONS = ["x-plugin-resolved"] as const;

/**
 * Strips properties from an incoming client payload whose schema marks them
 * `x-plugin-resolved`. Used at the connection create/update boundary so a
 * plugin's `startAuth` and the persisted `userConfig` never see user-supplied
 * values for fields the plugin is the sole source of truth for.
 */
export function stripRequestFields(schema: unknown, value: unknown): unknown {
  return stripExtensionFields(schema, value, REQUEST_STRIPPED_EXTENSIONS);
}

/**
 * Removes properties on `value` whose schema definition carries any of the
 * given extension flags set to `true`. Used so sensitive or internal-only
 * fields never travel back to clients via connection list/get responses.
 *
 * NOTE: Only walks the top-level `properties` of the schema. A nested
 * `object`-typed field whose own properties carry `x-private` / `x-secret`
 * will not be stripped — the flag must sit on the leaf field the host hands
 * back. All current built-in plugin schemas are flat, so this is a deliberate
 * simplification, not a gap to fill speculatively.
 */
// fallow-ignore-next-line complexity
export function stripExtensionFields(
  schema: unknown,
  value: unknown,
  extensions: readonly string[] = RESPONSE_STRIPPED_EXTENSIONS,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (!schema || typeof schema !== "object") return value;
  const props = (schema as { properties?: Record<string, Record<string, unknown>> }).properties;
  if (!props) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [name, def] of Object.entries(props)) {
    if (!def) continue;
    for (const ext of extensions) {
      if (def[ext] === true) {
        delete out[name];
        break;
      }
    }
  }
  return out;
}

/**
 * Strips every field that must never round-trip back to the client:
 * `x-secret` (encrypted at rest) and `x-private` (plaintext but hidden).
 */
export function stripResponseFields(schema: unknown, value: unknown): unknown {
  return stripExtensionFields(schema, value, RESPONSE_STRIPPED_EXTENSIONS);
}

/**
 * Computes the display-field list for a connection card from the plugin's
 * `userConfigSchema` and decrypted `userConfig`. Excludes `x-secret`, redacts
 * `x-private` as `"••••"`, marks URI-typed fields as `mono`, and preserves
 * schema declaration order. Returns `[]` when the schema has no displayable
 * fields or the user config is empty/missing.
 *
 * Schema-order output relies on `Object.entries()` preserving the JSON
 * insertion order of string-keyed properties (V8 / SpiderMonkey / JSC all
 * honour this for non-integer keys, and the manifest is JSON-parsed so all
 * keys are strings). Not formally guaranteed by the spec, but reliable in
 * every JS runtime this repo targets.
 */
// fallow-ignore-next-line complexity
export function computeDisplayFields(
  schema: unknown,
  value: unknown,
): Array<{ label: string; value: string; mono?: boolean }> {
  if (!schema || typeof schema !== "object") return [];
  const props = (schema as { properties?: Record<string, Record<string, unknown>> }).properties;
  if (!props) return [];
  const cfg =
    (value && typeof value === "object" ? (value as Record<string, unknown>) : null) ?? {};
  const out: Array<{ label: string; value: string; mono?: boolean }> = [];
  for (const [name, def] of Object.entries(props)) {
    const field = buildDisplayField(name, def, cfg);
    if (field) out.push(field);
  }
  return out;
}

// fallow-ignore-next-line complexity
function buildDisplayField(
  name: string,
  def: Record<string, unknown> | undefined,
  cfg: Record<string, unknown>,
): { label: string; value: string; mono?: boolean } | null {
  if (!def) return null;
  if (def["x-secret"] === true) return null;
  const isPrivate = def["x-private"] === true;
  const label =
    typeof def.title === "string" && def.title.length > 0 ? def.title : titleizeFieldName(name);
  const stored = cfg[name];
  const mono: true | undefined =
    def.format === "uri" ||
    def.format === "url" ||
    def["x-mono"] === true ||
    def["x-allowed-host"] === true
      ? true
      : undefined;
  // Empty / missing `x-private` values render as "" (the unset case)
  // rather than "••••" — there's no actual content to hide, and a
  // redaction badge for an unset field would mislead the reader.
  const stringValue =
    isPrivate && stored !== undefined && stored !== null && stored !== ""
      ? "••••"
      : stringifyDisplayValue(stored);
  return mono ? { label, value: stringValue, mono } : { label, value: stringValue };
}

function titleizeFieldName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// fallow-ignore-next-line complexity
function stringifyDisplayValue(v: unknown): string {
  if (isNil(v)) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    const primitives = v.filter(
      (x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean",
    );
    if (primitives.length === v.length) return primitives.map((x) => String(x)).join(", ");
    return "";
  }
  return "";
}

/** Promotes the given connection id to default within its plugin; demotes the rest. */
export async function promoteToDefault(
  userId: string,
  pluginId: string,
  connectionId: string,
): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(serviceConnections)
      .set({ isDefault: 0, updatedAt: now })
      .where(
        and(
          eq(serviceConnections.userId, userId),
          eq(serviceConnections.pluginId, pluginId),
          ne(serviceConnections.id, connectionId),
        ),
      );
    await tx
      .update(serviceConnections)
      .set({ isDefault: 1, updatedAt: now })
      .where(eq(serviceConnections.id, connectionId));
  });
}

async function ensureDefaultIfFirst(
  userId: string,
  pluginId: string,
  connectionId: string,
): Promise<void> {
  const db = getDb();
  // Single atomic conditional UPDATE: sets isDefault only when no other row for
  // this (userId, pluginId) already carries isDefault=1, eliminating the
  // SELECT→UPDATE race window.
  await db
    .update(serviceConnections)
    .set({ isDefault: 1 })
    .where(
      and(
        eq(serviceConnections.id, connectionId),
        notExists(
          db
            .select({ id: serviceConnections.id })
            .from(serviceConnections)
            .where(
              and(
                eq(serviceConnections.userId, userId),
                eq(serviceConnections.pluginId, pluginId),
                eq(serviceConnections.isDefault, 1),
                ne(serviceConnections.id, connectionId),
              ),
            ),
        ),
      ),
    );
}

/**
 * Rejects empty credential payloads. Plugins that declare a `credentialsSchema`
 * must produce a non-empty credentials object on successful auth; an empty one
 * is a "parked" connection under the new rules (see design doc).
 */
function hasRealCredentials(credentials: unknown): boolean {
  if (isNil(credentials)) return false;
  if (typeof credentials !== "object") return true;
  return Object.keys(credentials as Record<string, unknown>).length > 0;
}

// fallow-ignore-next-line complexity
export async function writeConnection(args: {
  userId: string;
  pluginId: string;
  displayName?: string;
  credentials: unknown;
  userConfig: unknown;
  tokenExpiresAt?: number;
  // No-auth plugins (manifest.auth.kind === "none") legitimately have no
  // credentials — userConfig carries everything (e.g. Telegram bot token).
  // The empty-credentials guard would reject these otherwise.
  allowEmptyCredentials?: boolean;
}): Promise<string> {
  if (!args.allowEmptyCredentials && !hasRealCredentials(args.credentials)) {
    throw internal(
      "connection.verify_failed",
      "cannot create connection with empty credentials — the plugin must return a populated credentials payload",
    );
  }
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const credEnc = await encryptJson(args.credentials);
  await db.insert(serviceConnections).values({
    id,
    userId: args.userId,
    pluginId: args.pluginId,
    status: "connected",
    enabled: 1,
    isDefault: 0,
    displayName: args.displayName ?? null,
    encryptedCredentials: credEnc.data,
    credentialsIv: credEnc.iv,
    userConfig:
      args.userConfig !== undefined && args.userConfig !== null
        ? JSON.stringify(args.userConfig)
        : null,
    tokenExpiresAt: args.tokenExpiresAt ?? null,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await ensureDefaultIfFirst(args.userId, args.pluginId, id);
  await invalidateUserCache(args.userId);
  return id;
}
