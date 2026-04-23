import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections } from "../db/schema";
import { env } from "../env";
import { encrypt, decrypt } from "../crypto/vault";
import { internal } from "../errors/http-errors";
import { invalidateUserCache } from "../media/dispatcher";

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

/** Promotes the given connection id to default within its plugin; demotes the rest. */
export async function promoteToDefault(
  userId: string,
  pluginId: string,
  connectionId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(serviceConnections)
    .set({ isDefault: 0, updatedAt: Date.now() })
    .where(
      and(
        eq(serviceConnections.userId, userId),
        eq(serviceConnections.pluginId, pluginId),
        ne(serviceConnections.id, connectionId),
      ),
    );
  await db
    .update(serviceConnections)
    .set({ isDefault: 1, updatedAt: Date.now() })
    .where(eq(serviceConnections.id, connectionId));
}

async function ensureDefaultIfFirst(
  userId: string,
  pluginId: string,
  connectionId: string,
): Promise<void> {
  const db = getDb();
  const count = await db
    .select({ id: serviceConnections.id })
    .from(serviceConnections)
    .where(and(eq(serviceConnections.userId, userId), eq(serviceConnections.pluginId, pluginId)))
    .all();
  if (count.length === 1) {
    await db
      .update(serviceConnections)
      .set({ isDefault: 1 })
      .where(eq(serviceConnections.id, connectionId));
  }
}

/**
 * Rejects empty credential payloads. Plugins that declare a `credentialsSchema`
 * must produce a non-empty credentials object on successful auth; an empty one
 * is a "parked" connection under the new rules (see design doc).
 */
function hasRealCredentials(credentials: unknown): boolean {
  if (credentials === null || credentials === undefined) return false;
  if (typeof credentials !== "object") return true;
  return Object.keys(credentials as Record<string, unknown>).length > 0;
}

export async function writeConnection(args: {
  userId: string;
  pluginId: string;
  displayName?: string;
  credentials: unknown;
  userConfig: unknown;
  tokenExpiresAt?: number;
}): Promise<string> {
  if (!hasRealCredentials(args.credentials)) {
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
