import { and, desc, eq, ne, notExists } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { serviceConnections } from "../db/schema";
import { encryptJson } from "../crypto/helpers";
import { internal, notFound } from "../diagnostics/http-errors";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { invalidateUserCache, resetWatchlistSeed } from "../media";
import { isNil } from "es-toolkit/predicate";

/**
 * Loads the connection row owned by `userId` or returns `null`. Used by
 * idempotent operations (test) where a missing row should resolve silently
 * rather than throw.
 */
export async function fetchConnectionByOwner(db: Db, connectionId: string, userId: string) {
  return (
    (await db
      .select()
      .from(serviceConnections)
      .where(and(eq(serviceConnections.id, connectionId), eq(serviceConnections.userId, userId)))
      .get()) ?? null
  );
}

/**
 * Loads the connection row owned by `userId` or throws `notFound("connection.not_found", ...)`.
 * Returns 404 for both "missing" and "owned by another user" so a hostile client can't probe
 * for foreign connection ids.
 */
export async function requireConnection(db: Db, connectionId: string, userId: string) {
  const row = await fetchConnectionByOwner(db, connectionId, userId);
  if (!row) throw notFound("connection.not_found", "connection not found");
  return row;
}

/**
 * JSON Schema extension keys that mark a field as never-returned to clients:
 * `x-secret` (encrypted at rest) and `x-private` (plaintext but internal-only).
 * A field may carry both; stripping is idempotent.
 */
export const RESPONSE_STRIPPED_EXTENSIONS = ["x-secret", "x-private"] as const;

/**
 * Fields marked `"x-plugin-resolved": true` in `userConfig` are plugin-owned; stripping them from
 * incoming payloads before `startAuth` or DB write prevents a hostile client from spoofing them
 * (e.g. impersonating another account). The plugin repopulates via `userConfigPatch`.
 */
export const REQUEST_STRIPPED_EXTENSIONS = ["x-plugin-resolved"] as const;

/**
 * Strips `x-plugin-resolved` fields from an incoming client payload so `startAuth`
 * and the persisted `userConfig` never see user-supplied values for plugin-owned fields.
 */
export function stripRequestFields(schema: unknown, value: unknown): unknown {
  return stripExtensionFields(schema, value, REQUEST_STRIPPED_EXTENSIONS);
}

/**
 * Removes properties on `value` whose schema definition carries any of the given extension flags.
 * Only walks top-level `properties` — nested fields are NOT stripped (flag must be on the leaf).
 * All built-in plugin schemas are flat, so this is deliberate, not a gap to fill speculatively.
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
 * Builds the display-field list for a connection card: excludes `x-secret`, redacts `x-private` as `"••••"`,
 * marks URI-typed fields as `mono`, preserving schema declaration order via `Object.entries()` insertion order
 * (not spec-guaranteed but consistent across V8/SpiderMonkey/JSC and every JS runtime this repo targets).
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

/**
 * Promotes the given connection to default; demotes the rest. The existence check uses
 * `.returning()` inside the transaction so a concurrent delete rolls back the demotion too —
 * otherwise a missing row would leave the plugin with zero defaults.
 */
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
    const rows = await tx
      .update(serviceConnections)
      .set({ isDefault: 1, updatedAt: now })
      .where(and(eq(serviceConnections.id, connectionId), eq(serviceConnections.userId, userId)))
      .returning({ id: serviceConnections.id });
    if (rows.length === 0) throw notFound("connection.not_found", "connection not found");
  });
}

async function ensureDefaultIfFirst(
  userId: string,
  pluginId: string,
  connectionId: string,
): Promise<void> {
  const db = getDb();
  // Single atomic conditional UPDATE: sets isDefault only when no other (userId, pluginId) row
  // already carries isDefault=1, eliminating the SELECT→UPDATE race. The outer userId predicate
  // is defense-in-depth so a forged connectionId can't flip a row owned by another user.
  await db
    .update(serviceConnections)
    .set({ isDefault: 1, updatedAt: Date.now() })
    .where(
      and(
        eq(serviceConnections.id, connectionId),
        eq(serviceConnections.userId, userId),
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
  // A brand-new connection may expose a watchlist the eager per-GET seed
  // already gave up on (locked after an earlier, possibly empty, run).
  // Clearing the lock lets the next GET re-fetch instead of waiting for
  // the 6-hourly cron sync.
  await resetWatchlistSeed(args.userId);
  return id;
}

/**
 * Returns the default connection for `(userId, pluginId)`, falling back to most-recently-created,
 * or `null` when the user has none. Deterministically resolves the row a reconnect should rebind to.
 */
export async function findConnectionForPlugin(db: Db, userId: string, pluginId: string) {
  return (
    (await db
      .select()
      .from(serviceConnections)
      .where(and(eq(serviceConnections.userId, userId), eq(serviceConnections.pluginId, pluginId)))
      .orderBy(desc(serviceConnections.isDefault), desc(serviceConnections.createdAt))
      .get()) ?? null
  );
}

/**
 * Rebinds a successful auth result to an existing connection (OAuth reconnect path). Re-encrypts
 * credentials, replaces `userConfig`, flips status to `connected`, clears `errorMessage`/`tokenExpiresAt`.
 * Preserves `displayName`, `isDefault`, and `enabled` — only auth-bearing fields change.
 */
export async function reconnectConnection(args: {
  connectionId: string;
  userId: string;
  credentials: unknown;
  userConfig: unknown;
}): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const credEnc = await encryptJson(args.credentials);
  await db
    .update(serviceConnections)
    .set({
      status: "connected",
      errorMessage: null,
      encryptedCredentials: credEnc.data,
      credentialsIv: credEnc.iv,
      userConfig:
        args.userConfig !== undefined && args.userConfig !== null
          ? JSON.stringify(args.userConfig)
          : null,
      tokenExpiresAt: null,
      lastVerifiedAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(serviceConnections.id, args.connectionId), eq(serviceConnections.userId, args.userId)),
    );
  await invalidateUserCache(args.userId);
}
