import { and, eq } from "drizzle-orm";
import type { JSONSchema } from "@ent-mcp/shared";
import { getDb } from "../db/client";
import { pendingAuth } from "../db/schema";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { pluginRuntime, resolveAllowedHostsFromSchema } from "../plugin-runtime";
import { isPluginError, type AuthResult } from "@ent-mcp/plugin-sdk";
import { badRequest, notFound, unprocessable } from "../diagnostics/http-errors";
import { encryptJson, decryptJson, stripRequestFields, writeConnection } from "./helpers";
import { isNil } from "es-toolkit/predicate";

/**
 * Merges a plugin-returned `userConfigPatch` into the submitted `userConfig`.
 * Returns the submitted value unchanged when the patch is absent so plugins
 * that don't need the feature stay on the zero-copy path. A `null` patch value
 * removes the key from the merged result, letting plugins strip submitted
 * secrets (e.g. a password that has been moved into the encrypted credentials
 * blob) from the persisted `userConfig` JSON.
 */
// fallow-ignore-next-line complexity
export function applyUserConfigPatch(
  userConfig: unknown,
  patch: Record<string, unknown> | undefined,
): unknown {
  if (!patch || Object.keys(patch).length === 0) return userConfig;
  const base =
    userConfig && typeof userConfig === "object" && !Array.isArray(userConfig)
      ? { ...(userConfig as Record<string, unknown>) }
      : ({} as Record<string, unknown>);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return base;
}

/**
 * Shape surfaced by `/verify-config` on failure. The optional `field` mirrors
 * the `params.field` convention used on HTTPError wire bodies so a single
 * client-side helper can handle both.
 */
export interface VerifyConfigResult {
  ok: boolean;
  message?: string;
  field?: string;
}

/** Extracts the `field` hint from an AuthResult error's params. */
function fieldFromAuthResult(result: AuthResult): string | undefined {
  if (result.status !== "error") return undefined;
  const field = result.params?.field;
  return typeof field === "string" ? field : undefined;
}

/**
 * Returns the first required, user-submittable field on the schema whose value
 * is blank in `value`, or `undefined` if every required field is populated.
 * Skips `x-plugin-resolved` fields — the plugin owns those values.
 */
// fallow-ignore-next-line complexity
function firstBlankRequiredField(schema: unknown, value: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const obj = schema as {
    properties?: Record<string, Record<string, unknown> | undefined>;
    required?: unknown;
  };
  const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
  if (required.length === 0) return undefined;
  const valueObj =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  for (const key of required) {
    const def = obj.properties?.[key];
    if (def?.["x-plugin-resolved"] === true) continue;
    const v = valueObj[key];
    if (isNil(v) || v === "") return key;
  }
  return undefined;
}

/**
 * Maps an AuthResult error to the typed `plugin.invalid_base_url` HTTP error
 * when the underlying cause was an `x-allowed-host` validation failure. The
 * runtime maps that throw into `plugin.invalid_base_url` with `params.field`,
 * so we can route on the code without string-matching.
 */
// fallow-ignore-next-line complexity
function rethrowAuthError(result: AuthResult): never {
  if (result.status !== "error") {
    throw unprocessable("connection.verify_failed", `unexpected status: ${result.status}`, {});
  }
  const message = result.devMessage;
  const field = fieldFromAuthResult(result);
  if (result.code === "plugin.invalid_base_url") {
    throw badRequest("plugin.invalid_base_url", message, {
      message,
      ...(field ? { field } : {}),
    });
  }
  throw unprocessable("connection.verify_failed", `auth failed: ${message}`, {
    message,
    ...(field ? { field } : {}),
  });
}

/**
 * Mirrors the runtime's `buildAuxContext` x-allowed-host check for the no-auth
 * create path. Plugins with `auth.kind !== "none"` go through `runAuth`, where
 * `buildAuxContext` resolves the same fields and `rethrowAuthError` maps the
 * resulting PluginError to a 400 — no-auth plugins skip that flow and would
 * persist malformed URLs without this guard.
 */
function validateAllowedHostFields(
  pluginId: string,
  schema: JSONSchema | undefined,
  userConfig: unknown,
): void {
  try {
    resolveAllowedHostsFromSchema(pluginId, schema, userConfig);
  } catch (err) {
    if (isPluginError(err) && err.code === "plugin.invalid_base_url") {
      throw badRequest("plugin.invalid_base_url", err.message, err.params);
    }
    throw err;
  }
}

type PendingAuthLookup =
  | { found: true; row: typeof pendingAuth.$inferSelect; state: unknown }
  | { found: false; reason: "not_found" | "expired" };

/** Inserts a `pendingAuth` row with the encrypted state and returns the nonce. */
async function storePendingAuth(
  db: ReturnType<typeof getDb>,
  { userId, pluginId }: { userId: string; pluginId: string },
  state: unknown,
): Promise<string> {
  const nonce = crypto.randomUUID();
  const now = Date.now();
  const enc = await encryptJson(state);
  await db.insert(pendingAuth).values({
    nonce,
    userId,
    pluginId,
    state: enc.data,
    stateIv: enc.iv,
    createdAt: now,
    expiresAt: now + 15 * 60 * 1000,
  });
  return nonce;
}

/**
 * Fetches the `pendingAuth` row for the given nonce and userId, deletes it if
 * expired, and decrypts the stored state. Returns a discriminated result so
 * callers can apply their own error semantics for not-found and expired cases.
 */
async function loadPendingAuth(
  db: ReturnType<typeof getDb>,
  nonce: string,
  userId: string,
): Promise<PendingAuthLookup> {
  const row = await db
    .select()
    .from(pendingAuth)
    .where(and(eq(pendingAuth.nonce, nonce), eq(pendingAuth.userId, userId)))
    .get();
  if (!row) return { found: false, reason: "not_found" };
  if (row.expiresAt < Date.now()) {
    await db.delete(pendingAuth).where(eq(pendingAuth.nonce, nonce));
    return { found: false, reason: "expired" };
  }
  const state = await decryptJson(row.stateIv, row.state);
  return { found: true, row, state };
}

async function runStartAuth<S extends "redirect" | "display_code">(
  pluginId: string,
  userId: string,
  expectedStatus: S,
  failLabel: string,
): Promise<Extract<AuthResult, { status: S }>> {
  const result = (await pluginRuntime.runAuth(pluginId, "startAuth", userId, null)) as AuthResult;
  if (result.status !== expectedStatus) {
    const message =
      result.status === "error" ? result.devMessage : `unexpected status: ${result.status}`;
    throw unprocessable("oauth.init_failed", `${failLabel}: ${message}`, { message });
  }
  return result as Extract<AuthResult, { status: S }>;
}

/**
 * Atomically consumes the `pendingAuth` row before writing the connection.
 *
 * Uses `DELETE ... RETURNING` so only the caller that actually removes the
 * row proceeds to `writeConnection`. Concurrent completions for the same
 * nonce see zero rows returned and signal via `consumed: false`, allowing
 * callers to surface a typed error instead of creating duplicate rows.
 *
 * The DELETE filters on both `nonce` and `userId` to mirror `loadPendingAuth`'s
 * predicate — a request authenticated as one user cannot consume another
 * user's pending row even if the nonce somehow leaks.
 *
 * Order matters: the delete happens BEFORE `writeConnection`. If the write
 * throws, the nonce is already gone and the user must restart the OAuth flow.
 * That trade-off is deliberate — a failed write is recoverable, a duplicate
 * connection row is not. Do not "fix" this by swapping the order.
 */
async function consumeAndWritePendingAuth(
  db: ReturnType<typeof getDb>,
  nonce: string,
  {
    userId,
    pluginId,
    result,
  }: {
    userId: string;
    pluginId: string;
    result: Extract<AuthResult, { status: "completed" }>;
  },
): Promise<{ consumed: true; id: string } | { consumed: false }> {
  const deleted = await db
    .delete(pendingAuth)
    .where(and(eq(pendingAuth.nonce, nonce), eq(pendingAuth.userId, userId)))
    .returning({ nonce: pendingAuth.nonce });
  if (deleted.length === 0) return { consumed: false };
  const id = await writeConnection({
    userId,
    pluginId,
    credentials: result.credentials,
    userConfig: applyUserConfigPatch(null, result.userConfigPatch),
  });
  return { consumed: true, id };
}

// fallow-ignore-next-line complexity
export async function verifyConfig(args: {
  userId: string;
  pluginId: string;
  userConfig: unknown;
}): Promise<VerifyConfigResult> {
  // Surface blank-required-field submissions as a typed error before any
  // plugin work. Mirrors the create path; the modal routes the result to the
  // offending input via `params.field`.
  const module = await pluginRuntime.getModule(args.pluginId);
  const blank = firstBlankRequiredField(module.manifest.userConfigSchema, args.userConfig);
  if (blank) {
    throw badRequest("plugin.credentials_empty", `${blank} is required`, { field: blank });
  }
  try {
    const result = (await pluginRuntime.runAuth(
      args.pluginId,
      "startAuth",
      args.userId,
      args.userConfig,
    )) as AuthResult;
    if (result.status === "completed") return { ok: true };
    if (result.status === "error" && result.code === "plugin.invalid_base_url") {
      // Surface as a typed HTTP error so the client can route to a field; matches
      // the create-path behaviour rather than dropping it into the generic body.
      const field = fieldFromAuthResult(result);
      throw badRequest("plugin.invalid_base_url", result.devMessage, {
        message: result.devMessage,
        ...(field ? { field } : {}),
      });
    }
    const message =
      result.status === "error" ? result.devMessage : `unexpected status: ${result.status}`;
    const field = fieldFromAuthResult(result);
    return field ? { ok: false, message, field } : { ok: false, message };
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    return { ok: false, message: err instanceof Error ? err.message : "verification failed" };
  }
}

/** Returns the top-level `properties` object on a JSON schema, or `{}` when
 *  the schema is missing one. Narrows the loose `JSONSchema` shape once so
 *  call sites can index `properties[key]` without re-asserting. */
function schemaProperties(schema: JSONSchema | undefined): Record<string, JSONSchema> {
  const props = (schema as { properties?: Record<string, JSONSchema> } | undefined)?.properties;
  return props ?? {};
}

/** Separates x-secret fields out of a userConfig object so they can be stored
 *  in the encrypted credentials blob rather than the plaintext userConfig column.
 *  Non-object configs short-circuit to empty buckets — the caller's schema
 *  guarantees an object root, so this branch only protects against malformed
 *  inputs reaching `Object.entries`. */
// fallow-ignore-next-line complexity
function extractSecretFields(
  schema: JSONSchema | undefined,
  config: unknown,
): { credentials: Record<string, unknown>; userConfig: Record<string, unknown> } {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { credentials: {}, userConfig: {} };
  }
  const props = schemaProperties(schema);
  const credentials: Record<string, unknown> = {};
  const userConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (props[key]?.["x-secret"] === true) credentials[key] = value;
    else userConfig[key] = value;
  }
  return { credentials, userConfig };
}

export async function createFormConnection(args: {
  userId: string;
  pluginId: string;
  userConfig: unknown;
  displayName?: string;
}): Promise<{ id: string }> {
  // `x-plugin-resolved` fields are owned by the plugin; drop any value the
  // client tried to submit before the payload reaches `startAuth` or the
  // persisted row. The plugin repopulates them via `userConfigPatch`.
  const module = await pluginRuntime.getModule(args.pluginId);
  const sanitized = stripRequestFields(module.manifest.userConfigSchema, args.userConfig);
  const blank = firstBlankRequiredField(module.manifest.userConfigSchema, sanitized);
  if (blank) {
    throw badRequest("plugin.credentials_empty", `${blank} is required`, { field: blank });
  }
  // No-auth plugins (e.g. notification channels like Telegram, Discord, ntfy)
  // do not export `startAuth` — userConfig itself carries everything the plugin
  // needs and there is no upstream credential exchange. Persist the row directly;
  // upstream reachability is exercised later via the capability's `testDelivery`
  // or the channel test endpoint.
  if (module.manifest.auth.kind === "none") {
    validateAllowedHostFields(args.pluginId, module.manifest.userConfigSchema, sanitized);
    // Lift x-secret fields out of userConfig into the encrypted credentials blob
    // so no-auth plugins honour the "encrypted at rest" guarantee.
    const { credentials: secretCredentials, userConfig: strippedConfig } = extractSecretFields(
      module.manifest.userConfigSchema,
      sanitized,
    );
    const id = await writeConnection({
      userId: args.userId,
      pluginId: args.pluginId,
      credentials: secretCredentials,
      userConfig: strippedConfig,
      displayName: args.displayName,
      allowEmptyCredentials: true,
    });
    return { id };
  }
  const result = (await pluginRuntime.runAuth(
    args.pluginId,
    "startAuth",
    args.userId,
    sanitized,
  )) as AuthResult;
  if (result.status !== "completed") rethrowAuthError(result);
  const id = await writeConnection({
    userId: args.userId,
    pluginId: args.pluginId,
    credentials: result.credentials,
    userConfig: applyUserConfigPatch(sanitized, result.userConfigPatch),
    displayName: args.displayName,
  });
  return { id };
}

export async function initiateRedirectAuth(args: {
  userId: string;
  pluginId: string;
}): Promise<{ redirectUrl: string; nonce: string }> {
  const db = getDb();
  const result = await runStartAuth(
    args.pluginId,
    args.userId,
    "redirect",
    "redirect auth init failed",
  );
  const nonce = await storePendingAuth(db, args, result.state);
  return { redirectUrl: result.url, nonce };
}

// fallow-ignore-next-line complexity
export async function completeRedirectAuth(args: {
  userId: string;
  nonce: string;
  queryParams: Record<string, string>;
}): Promise<{ connectionId: string }> {
  const db = getDb();
  const auth = await loadPendingAuth(db, args.nonce, args.userId);
  if (!auth.found) {
    if (auth.reason === "not_found") throw notFound("oauth.pending_not_found", "no pending auth");
    throw unprocessable("oauth.state_expired", "authorization request expired");
  }
  const result = (await pluginRuntime.runAuth(
    auth.row.pluginId,
    "completeAuth",
    args.userId,
    args.queryParams,
    auth.state,
  )) as AuthResult;
  if (result.status !== "completed") {
    if (result.status === "error") {
      await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
      throw unprocessable("connection.verify_failed", result.devMessage, {
        message: result.devMessage,
      });
    }
    throw unprocessable("oauth.unexpected_status", `unexpected status: ${result.status}`, {
      status: result.status,
    });
  }
  const outcome = await consumeAndWritePendingAuth(db, args.nonce, {
    userId: args.userId,
    pluginId: auth.row.pluginId,
    result,
  });
  if (!outcome.consumed) {
    throw unprocessable(
      "oauth.concurrent_completion",
      "auth nonce already consumed by a concurrent request",
    );
  }
  return { connectionId: outcome.id };
}

export async function initiateDeviceAuth(args: { userId: string; pluginId: string }): Promise<{
  userCode: string;
  verifyUrl: string;
  nonce: string;
  intervalSec: number;
  expiresAt: number;
}> {
  const db = getDb();
  const result = await runStartAuth(
    args.pluginId,
    args.userId,
    "display_code",
    "device auth init failed",
  );
  const nonce = await storePendingAuth(db, args, result.pollState);
  return {
    userCode: result.code,
    verifyUrl: result.verifyUrl,
    nonce,
    intervalSec: result.intervalSec,
    expiresAt: result.expiresAt,
  };
}

// fallow-ignore-next-line complexity
export async function pollDeviceAuth(args: {
  userId: string;
  nonce: string;
}): Promise<
  | { status: "pending" }
  | { status: "completed"; connectionId: string }
  | { status: "error"; message: string }
> {
  const db = getDb();
  const auth = await loadPendingAuth(db, args.nonce, args.userId);
  if (!auth.found) {
    return {
      status: "error",
      message: auth.reason === "expired" ? "device code expired" : "no pending auth",
    };
  }
  const result = (await pluginRuntime.runAuth(
    auth.row.pluginId,
    "pollAuth",
    args.userId,
    null,
    auth.state,
  )) as AuthResult;
  if (result.status === "pending") return { status: "pending" };
  if (result.status === "completed") {
    const outcome = await consumeAndWritePendingAuth(db, args.nonce, {
      userId: args.userId,
      pluginId: auth.row.pluginId,
      result,
    });
    if (!outcome.consumed) {
      return {
        status: "error",
        message: "auth nonce already consumed by a concurrent request",
      };
    }
    return { status: "completed", connectionId: outcome.id };
  }
  if (result.status === "error") {
    await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
    return { status: "error", message: result.devMessage };
  }
  return { status: "error", message: `unexpected status: ${result.status}` };
}
