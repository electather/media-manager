import { and, eq } from "drizzle-orm";
import type { JSONSchema } from "@nama/shared";
import { getDb } from "../db/client";
import { pendingAuth } from "../db/schema";
import { parseUserConfig } from "../db/queries";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { pluginRuntime, resolveAllowedHostsFromSchema } from "../plugin-runtime";
import { isPluginError, type AuthResult } from "@nama/plugin-sdk";
import { badRequest, notFound, unprocessable } from "../diagnostics/http-errors";
import { decryptField, encryptJson } from "../crypto/helpers";
import {
  findConnectionForPlugin,
  reconnectConnection,
  stripRequestFields,
  writeConnection,
} from "./helpers";
import { isNil } from "es-toolkit/predicate";

/**
 * Merges a plugin-returned `userConfigPatch` into the submitted `userConfig`.
 * A `null` patch value removes the key — lets plugins strip submitted secrets
 * (e.g. a password moved into the encrypted credentials blob) from persisted JSON.
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
interface VerifyConfigResult {
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
 * Strips `x-plugin-resolved` fields and rejects blank required fields with
 * `plugin.credentials_empty` before any plugin work runs. Shared by the verify
 * and create paths; both need the resolved `module` and `sanitized` config.
 */
async function assertRequiredUserConfig(
  pluginId: string,
  userConfig: unknown,
): Promise<{ module: Awaited<ReturnType<typeof pluginRuntime.getModule>>; sanitized: unknown }> {
  const module = await pluginRuntime.getModule(pluginId);
  const sanitized = stripRequestFields(module.manifest.userConfigSchema, userConfig);
  const blank = firstBlankRequiredField(module.manifest.userConfigSchema, sanitized);
  if (blank) {
    throw badRequest("plugin.credentials_empty", `${blank} is required`, { field: blank });
  }
  return { module, sanitized };
}

/**
 * Maps an AuthResult error to a typed HTTP error. Routes `plugin.invalid_base_url`
 * (from `x-allowed-host` validation failures) to a 400; all other errors to 422.
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
 * Mirrors `buildAuxContext`'s x-allowed-host check for the no-auth create path.
 * Non-none auth kinds go through `runAuth` where `buildAuxContext` handles this;
 * no-auth plugins skip that flow and would persist malformed URLs without this guard.
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
    await db
      .delete(pendingAuth)
      .where(and(eq(pendingAuth.nonce, nonce), eq(pendingAuth.userId, userId)));
    return { found: false, reason: "expired" };
  }
  const state = await decryptField(row.stateIv, row.state);
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
 * Shared init for both `startAuth` entry points: runs `startAuth` expecting
 * `mode`, persists the pending row with `pickState(result)`, and returns the
 * `nonce` + narrowed `result` so each caller builds its own response.
 */
async function startAuthAndStore<S extends "redirect" | "display_code">(
  args: { userId: string; pluginId: string },
  mode: S,
  failMsg: string,
  pickState: (result: Extract<AuthResult, { status: S }>) => unknown,
): Promise<{ nonce: string; result: Extract<AuthResult, { status: S }> }> {
  const db = getDb();
  const result = await runStartAuth(args.pluginId, args.userId, mode, failMsg);
  const nonce = await storePendingAuth(db, args, pickState(result));
  return { nonce, result };
}

/**
 * Atomically consumes the `pendingAuth` row via `DELETE ... RETURNING` — only the caller that removes the row
 * proceeds; concurrent completions get `consumed: false`. Filters on both `nonce` and `userId` so a leaked nonce
 * cannot be consumed by a different user (spoofing). DELETE runs BEFORE `writeConnection`: failed write is recoverable; duplicate connection row is not.
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
  const id = await persistConnectionFromAuth(db, { userId, pluginId, result });
  return { consumed: true, id };
}

/**
 * Persists a completed auth result. For non-poolable plugins with an existing `(userId, pluginId)` row,
 * reconnects in place — rebinding avoids orphaning the original row's `isDefault`, `displayName`, and primary-provider references.
 * Poolable plugins and the no-existing-row case always insert a new row.
 */
async function persistConnectionFromAuth(
  db: ReturnType<typeof getDb>,
  {
    userId,
    pluginId,
    result,
  }: {
    userId: string;
    pluginId: string;
    result: Extract<AuthResult, { status: "completed" }>;
  },
): Promise<string> {
  const module = await pluginRuntime.getModule(pluginId);
  if (!module.manifest.poolable) {
    const existing = await findConnectionForPlugin(db, userId, pluginId);
    if (existing) {
      // Use a guarded parse: a malformed row must not block the reconnect path.
      const priorConfig = parseUserConfig(existing.userConfig, existing.id);
      await reconnectConnection({
        connectionId: existing.id,
        userId,
        credentials: result.credentials,
        userConfig: applyUserConfigPatch(priorConfig, result.userConfigPatch),
      });
      return existing.id;
    }
  }
  return writeConnection({
    userId,
    pluginId,
    credentials: result.credentials,
    userConfig: applyUserConfigPatch(null, result.userConfigPatch),
  });
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
  // `x-plugin-resolved` fields are owned by the plugin; drop any value the
  // client tried to submit before reaching `startAuth`, matching the create path.
  const { sanitized } = await assertRequiredUserConfig(args.pluginId, args.userConfig);
  try {
    const result = (await pluginRuntime.runAuth(
      args.pluginId,
      "startAuth",
      args.userId,
      sanitized,
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
  const { module, sanitized } = await assertRequiredUserConfig(args.pluginId, args.userConfig);
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
  const { nonce, result } = await startAuthAndStore(
    args,
    "redirect",
    "redirect auth init failed",
    (r) => r.state,
  );
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
      await db
        .delete(pendingAuth)
        .where(and(eq(pendingAuth.nonce, args.nonce), eq(pendingAuth.userId, args.userId)));
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
  const { nonce, result } = await startAuthAndStore(
    args,
    "display_code",
    "device auth init failed",
    (r) => r.pollState,
  );
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
    await db
      .delete(pendingAuth)
      .where(and(eq(pendingAuth.nonce, args.nonce), eq(pendingAuth.userId, args.userId)));
    return { status: "error", message: result.devMessage };
  }
  return { status: "error", message: `unexpected status: ${result.status}` };
}
