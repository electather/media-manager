import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections, pendingAuth, plugins } from "../db/schema";
import { env } from "../env";
import { encrypt, decrypt } from "../crypto/vault";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { capabilityRegistry } from "../plugin-runtime/registry";
import type { AuthResult } from "../plugin-runtime/types";

function split(combined: string): { iv: string; data: string } {
  const [iv, ...rest] = combined.split(":");
  if (!iv || rest.length === 0) throw new Error("invalid ciphertext");
  return { iv, data: rest.join(":") };
}

async function encryptJson(value: unknown): Promise<{ iv: string; data: string }> {
  const combined = await encrypt(JSON.stringify(value), env.ENCRYPTION_KEY);
  return split(combined);
}

async function decryptJson(iv: string | null, data: string | null): Promise<unknown> {
  if (!iv || !data) return null;
  const plain = await decrypt(`${iv}:${data}`, env.ENCRYPTION_KEY);
  try {
    return JSON.parse(plain);
  } catch {
    return plain;
  }
}

/** Promotes the given connection id to default within its plugin; demotes the rest. */
async function promoteToDefault(userId: string, pluginId: string, connectionId: string) {
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

async function ensureDefaultIfFirst(userId: string, pluginId: string, connectionId: string) {
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

async function writeConnection(args: {
  userId: string;
  pluginId: string;
  displayName?: string;
  credentials: unknown;
  userConfig: unknown;
  tokenExpiresAt?: number;
}): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const credEnc = await encryptJson(args.credentials);
  const userCfgEnc =
    args.userConfig !== undefined && args.userConfig !== null
      ? await encryptJson(args.userConfig)
      : null;
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
    encryptedUserConfig: userCfgEnc?.data ?? null,
    userConfigIv: userCfgEnc?.iv ?? null,
    tokenExpiresAt: args.tokenExpiresAt ?? null,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await ensureDefaultIfFirst(args.userId, args.pluginId, id);
  return id;
}

export interface ConnectionListItem {
  id: string;
  pluginId: string;
  status: string;
  enabled: boolean;
  isDefault: boolean;
  displayName: string | null;
  tokenExpiresAt: number | null;
  lastVerifiedAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  plugin: {
    id: string;
    name: string;
    auth: string;
    enabled: boolean;
  };
}

export const connectionsService = {
  async listForUser(userId: string): Promise<ConnectionListItem[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId))
      .orderBy(desc(serviceConnections.isDefault), desc(serviceConnections.createdAt))
      .all();

    const result: ConnectionListItem[] = [];
    for (const row of rows) {
      const pluginRow = await db.select().from(plugins).where(eq(plugins.id, row.pluginId)).get();
      if (!pluginRow) continue;
      const manifest = JSON.parse(pluginRow.manifest) as {
        name: string;
        auth: { kind: string };
      };
      result.push({
        id: row.id,
        pluginId: row.pluginId,
        status: row.status,
        enabled: row.enabled === 1,
        isDefault: row.isDefault === 1,
        displayName: row.displayName,
        tokenExpiresAt: row.tokenExpiresAt,
        lastVerifiedAt: row.lastVerifiedAt,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        plugin: {
          id: pluginRow.id,
          name: manifest.name,
          auth: manifest.auth.kind,
          enabled: pluginRow.enabled === 1,
        },
      });
    }
    return result;
  },

  async getUserConfig(userId: string, connectionId: string): Promise<unknown> {
    const db = getDb();
    const row = await db
      .select()
      .from(serviceConnections)
      .where(and(eq(serviceConnections.id, connectionId), eq(serviceConnections.userId, userId)))
      .get();
    if (!row) throw new Error("connection not found");
    return decryptJson(row.userConfigIv, row.encryptedUserConfig);
  },

  async createFormConnection(args: {
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
        result.status === "error" ? result.message : `unexpected status: ${result.status}`;
      throw new Error(`auth failed: ${message}`);
    }
    const id = await writeConnection({
      userId: args.userId,
      pluginId: args.pluginId,
      credentials: result.credentials,
      userConfig: args.userConfig,
      displayName: args.displayName,
    });
    return { id };
  },

  async initiateDeviceAuth(args: { userId: string; pluginId: string }): Promise<{
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
        result.status === "error" ? result.message : `unexpected status: ${result.status}`;
      throw new Error(`device auth init failed: ${message}`);
    }
    const nonce = randomUUID();
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
  },

  async pollDeviceAuth(args: {
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
        userConfig: null,
      });
      await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
      return { status: "completed", connectionId: id };
    }
    if (result.status === "error") {
      await db.delete(pendingAuth).where(eq(pendingAuth.nonce, args.nonce));
      return { status: "error", message: result.message };
    }
    return { status: "error", message: `unexpected status: ${result.status}` };
  },

  async setDefault(args: { userId: string; connectionId: string }): Promise<void> {
    const db = getDb();
    const row = await db
      .select()
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.id, args.connectionId),
          eq(serviceConnections.userId, args.userId),
        ),
      )
      .get();
    if (!row) throw new Error("connection not found");
    await promoteToDefault(args.userId, row.pluginId, args.connectionId);
  },

  async setEnabled(args: {
    userId: string;
    connectionId: string;
    enabled: boolean;
  }): Promise<void> {
    const db = getDb();
    await db
      .update(serviceConnections)
      .set({ enabled: args.enabled ? 1 : 0, updatedAt: Date.now() })
      .where(
        and(
          eq(serviceConnections.id, args.connectionId),
          eq(serviceConnections.userId, args.userId),
        ),
      );
  },

  async updateDisplayName(args: {
    userId: string;
    connectionId: string;
    displayName: string;
  }): Promise<void> {
    const db = getDb();
    await db
      .update(serviceConnections)
      .set({ displayName: args.displayName, updatedAt: Date.now() })
      .where(
        and(
          eq(serviceConnections.id, args.connectionId),
          eq(serviceConnections.userId, args.userId),
        ),
      );
  },

  async updateUserConfig(args: {
    userId: string;
    connectionId: string;
    userConfig: unknown;
  }): Promise<void> {
    const db = getDb();
    const row = await db
      .select()
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.id, args.connectionId),
          eq(serviceConnections.userId, args.userId),
        ),
      )
      .get();
    if (!row) throw new Error("connection not found");
    const credentials = await decryptJson(row.credentialsIv, row.encryptedCredentials);
    const test = await pluginRuntime.testConnection(
      row.pluginId,
      args.userId,
      credentials,
      args.userConfig,
    );
    if (!test.ok) throw new Error(`config did not verify: ${test.message ?? "unknown"}`);
    const enc = await encryptJson(args.userConfig);
    await db
      .update(serviceConnections)
      .set({
        encryptedUserConfig: enc.data,
        userConfigIv: enc.iv,
        lastVerifiedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(eq(serviceConnections.id, args.connectionId));
  },

  async delete(args: { userId: string; connectionId: string }): Promise<void> {
    const db = getDb();
    const row = await db
      .select()
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.id, args.connectionId),
          eq(serviceConnections.userId, args.userId),
        ),
      )
      .get();
    if (!row) return;
    await db.delete(serviceConnections).where(eq(serviceConnections.id, args.connectionId));
    if (row.isDefault === 1) {
      // Promote another enabled connection to default if any remain.
      const next = await db
        .select()
        .from(serviceConnections)
        .where(
          and(
            eq(serviceConnections.userId, args.userId),
            eq(serviceConnections.pluginId, row.pluginId),
            eq(serviceConnections.enabled, 1),
          ),
        )
        .orderBy(desc(serviceConnections.createdAt))
        .get();
      if (next) {
        await db
          .update(serviceConnections)
          .set({ isDefault: 1, updatedAt: Date.now() })
          .where(eq(serviceConnections.id, next.id));
      }
    }
  },

  async test(args: {
    userId: string;
    connectionId: string;
  }): Promise<{ ok: boolean; message?: string }> {
    const db = getDb();
    const row = await db
      .select()
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.id, args.connectionId),
          eq(serviceConnections.userId, args.userId),
        ),
      )
      .get();
    if (!row) return { ok: false, message: "connection not found" };
    const credentials = await decryptJson(row.credentialsIv, row.encryptedCredentials);
    const userConfig = await decryptJson(row.userConfigIv, row.encryptedUserConfig);
    const result = await pluginRuntime.testConnection(
      row.pluginId,
      args.userId,
      credentials,
      userConfig,
    );
    await db
      .update(serviceConnections)
      .set({
        status: result.ok ? "connected" : "error",
        errorMessage: result.ok ? null : (result.message ?? "test failed"),
        lastVerifiedAt: result.ok ? Date.now() : row.lastVerifiedAt,
        updatedAt: Date.now(),
      })
      .where(eq(serviceConnections.id, args.connectionId));
    return result;
  },

  async listAvailablePlugins(): Promise<
    Array<{
      id: string;
      name: string;
      auth: string;
      hasSharedConfig: boolean;
      userConfigSchema: unknown;
      credentialsSchema: unknown;
    }>
  > {
    const db = getDb();
    const rows = await db.select().from(plugins).where(eq(plugins.enabled, 1)).all();
    return rows
      .filter((r) => capabilityRegistry.get(r.id))
      .map((r) => {
        const manifest = JSON.parse(r.manifest) as {
          name: string;
          auth: { kind: string };
          userConfigSchema?: unknown;
          credentialsSchema?: unknown;
        };
        return {
          id: r.id,
          name: manifest.name,
          auth: manifest.auth.kind,
          hasSharedConfig: !!(r.globalConfig && r.globalConfigIv),
          userConfigSchema: manifest.userConfigSchema ?? null,
          credentialsSchema: manifest.credentialsSchema ?? null,
        };
      });
  },
};

/** Sweeps expired pending_auth rows. Called by the cron. */
export async function sweepPendingAuth(): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(pendingAuth)
    .where(lt(pendingAuth.expiresAt, Date.now()))
    .returning({ nonce: pendingAuth.nonce });
  return result.length;
}
