import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { pendingAuth } from "../db/schema";
import { pluginRuntime } from "../plugin-runtime/runtime";
import type { AuthResult } from "@ent-mcp/plugin-sdk";
import { badRequest, notFound, unprocessable } from "../errors/http-errors";
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

/** Writes a connection row and deletes the consumed `pendingAuth` record. */
async function writeAndCleanupPendingAuth(
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
): Promise<string> {
  const id = await writeConnection({
    userId,
    pluginId,
    credentials: result.credentials,
    userConfig: applyUserConfigPatch(null, result.userConfigPatch),
  });
  await db.delete(pendingAuth).where(eq(pendingAuth.nonce, nonce));
  return id;
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

  // Auth-none plugins (e.g. notification channels: discord, telegram, ntfy)
  // have no startAuth and carry no credentials — the connection IS the
  // userConfig. Persist directly with a sentinel so writeConnection's
  // non-empty credentials guard is satisfied; the sentinel is never read back
  // by these plugins (they only consume channelConfig / userConfig).
  if (module.manifest.auth.kind === "none") {
    const id = await writeConnection({
      userId: args.userId,
      pluginId: args.pluginId,
      credentials: { kind: "none" },
      userConfig: sanitized,
      displayName: args.displayName,
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
  const connectionId = await writeAndCleanupPendingAuth(db, args.nonce, {
    userId: args.userId,
    pluginId: auth.row.pluginId,
    result,
  });
  return { connectionId };
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
    const connectionId = await writeAndCleanupPendingAuth(db, args.nonce, {
      userId: args.userId,
      pluginId: auth.row.pluginId,
      result,
    });
    return { status: "completed", connectionId };
  }
  if (result.status === "error") {
    await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
    return { status: "error", message: result.devMessage };
  }
  return { status: "error", message: `unexpected status: ${result.status}` };
}
