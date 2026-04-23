import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { pendingAuth } from "../db/schema";
import { pluginRuntime } from "../plugin-runtime/runtime";
import type { AuthResult } from "../plugin-runtime/types";
import { notFound, unprocessable } from "../errors/http-errors";
import { encryptJson, decryptJson, writeConnection } from "./helpers";

/**
 * Merges a plugin-returned `userConfigPatch` into the submitted `userConfig`.
 * Returns the submitted value unchanged when the patch is absent so plugins
 * that don't need the feature stay on the zero-copy path.
 */
function applyUserConfigPatch(
  userConfig: unknown,
  patch: Record<string, unknown> | undefined,
): unknown {
  if (!patch || Object.keys(patch).length === 0) return userConfig;
  const base =
    userConfig && typeof userConfig === "object" && !Array.isArray(userConfig)
      ? (userConfig as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

export async function verifyConfig(args: {
  userId: string;
  pluginId: string;
  userConfig: unknown;
}): Promise<{ ok: boolean; message?: string }> {
  try {
    const result = (await pluginRuntime.runAuth(
      args.pluginId,
      "startAuth",
      args.userId,
      args.userConfig,
    )) as AuthResult;
    if (result.status === "completed") return { ok: true };
    const message =
      result.status === "error" ? result.devMessage : `unexpected status: ${result.status}`;
    return { ok: false, message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "verification failed" };
  }
}

export async function createFormConnection(args: {
  userId: string;
  pluginId: string;
  userConfig: unknown;
  displayName?: string;
}): Promise<{ id: string }> {
  const result = (await pluginRuntime.runAuth(
    args.pluginId,
    "startAuth",
    args.userId,
    args.userConfig,
  )) as AuthResult;
  if (result.status !== "completed") {
    const message =
      result.status === "error" ? result.devMessage : `unexpected status: ${result.status}`;
    throw unprocessable("connection.verify_failed", `auth failed: ${message}`, { message });
  }
  const id = await writeConnection({
    userId: args.userId,
    pluginId: args.pluginId,
    credentials: result.credentials,
    userConfig: applyUserConfigPatch(args.userConfig, result.userConfigPatch),
    displayName: args.displayName,
  });
  return { id };
}

export async function initiateRedirectAuth(args: {
  userId: string;
  pluginId: string;
}): Promise<{ redirectUrl: string; nonce: string }> {
  const db = getDb();
  const result = (await pluginRuntime.runAuth(
    args.pluginId,
    "startAuth",
    args.userId,
    null,
  )) as AuthResult;
  if (result.status !== "redirect") {
    const message =
      result.status === "error" ? result.devMessage : `unexpected status: ${result.status}`;
    throw unprocessable("oauth.init_failed", `redirect auth init failed: ${message}`, { message });
  }
  const nonce = crypto.randomUUID();
  const now = Date.now();
  const enc = await encryptJson(result.state);
  await db.insert(pendingAuth).values({
    nonce,
    userId: args.userId,
    pluginId: args.pluginId,
    state: enc.data,
    stateIv: enc.iv,
    createdAt: now,
    expiresAt: now + 15 * 60 * 1000,
  });
  return { redirectUrl: result.url, nonce };
}

export async function completeRedirectAuth(args: {
  userId: string;
  nonce: string;
  queryParams: Record<string, string>;
}): Promise<{ connectionId: string }> {
  const db = getDb();
  const row = await db
    .select()
    .from(pendingAuth)
    .where(and(eq(pendingAuth.nonce, args.nonce), eq(pendingAuth.userId, args.userId)))
    .get();
  if (!row) throw notFound("oauth.pending_not_found", "no pending auth");
  if (row.expiresAt < Date.now()) {
    await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
    throw unprocessable("oauth.state_expired", "authorization request expired");
  }
  const state = await decryptJson(row.stateIv, row.state);
  const result = (await pluginRuntime.runAuth(
    row.pluginId,
    "completeAuth",
    args.userId,
    args.queryParams,
    state,
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
  const id = await writeConnection({
    userId: args.userId,
    pluginId: row.pluginId,
    credentials: result.credentials,
    userConfig: applyUserConfigPatch(null, result.userConfigPatch),
  });
  await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
  return { connectionId: id };
}

export async function initiateDeviceAuth(args: { userId: string; pluginId: string }): Promise<{
  userCode: string;
  verifyUrl: string;
  nonce: string;
  intervalSec: number;
  expiresAt: number;
}> {
  const db = getDb();
  const result = (await pluginRuntime.runAuth(
    args.pluginId,
    "startAuth",
    args.userId,
    null,
  )) as AuthResult;
  if (result.status !== "display_code") {
    const message =
      result.status === "error" ? result.devMessage : `unexpected status: ${result.status}`;
    throw unprocessable("oauth.init_failed", `device auth init failed: ${message}`, { message });
  }
  const nonce = crypto.randomUUID();
  const now = Date.now();
  const enc = await encryptJson(result.pollState);
  await db.insert(pendingAuth).values({
    nonce,
    userId: args.userId,
    pluginId: args.pluginId,
    state: enc.data,
    stateIv: enc.iv,
    createdAt: now,
    expiresAt: now + 15 * 60 * 1000,
  });
  return {
    userCode: result.code,
    verifyUrl: result.verifyUrl,
    nonce,
    intervalSec: result.intervalSec,
    expiresAt: result.expiresAt,
  };
}

export async function pollDeviceAuth(args: {
  userId: string;
  nonce: string;
}): Promise<
  | { status: "pending" }
  | { status: "completed"; connectionId: string }
  | { status: "error"; message: string }
> {
  const db = getDb();
  const row = await db
    .select()
    .from(pendingAuth)
    .where(and(eq(pendingAuth.nonce, args.nonce), eq(pendingAuth.userId, args.userId)))
    .get();
  if (!row) return { status: "error", message: "no pending auth" };
  if (row.expiresAt < Date.now()) {
    await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
    return { status: "error", message: "device code expired" };
  }
  const pollState = await decryptJson(row.stateIv, row.state);
  const result = (await pluginRuntime.runAuth(
    row.pluginId,
    "pollAuth",
    args.userId,
    null,
    pollState,
  )) as AuthResult;
  if (result.status === "pending") return { status: "pending" };
  if (result.status === "completed") {
    const id = await writeConnection({
      userId: args.userId,
      pluginId: row.pluginId,
      credentials: result.credentials,
      userConfig: applyUserConfigPatch(null, result.userConfigPatch),
    });
    await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
    return { status: "completed", connectionId: id };
  }
  if (result.status === "error") {
    await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
    return { status: "error", message: result.devMessage };
  }
  return { status: "error", message: `unexpected status: ${result.status}` };
}
