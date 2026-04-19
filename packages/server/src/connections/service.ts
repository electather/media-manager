import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections, pendingAuth, plugins } from "../db/schema";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { capabilityRegistry } from "../plugin-runtime/registry";
import type { AuthResult } from "../plugin-runtime/types";
import { invalidateUserCache } from "../media/dispatcher";
import { badRequest, notFound, unprocessable } from "../errors/http-errors";
import { decryptJson, encryptJson, promoteToDefault, stripSecretFields } from "./helpers";
import {
  verifyConfig,
  createFormConnection,
  initiateRedirectAuth,
  completeRedirectAuth,
  initiateDeviceAuth,
  pollDeviceAuth,
} from "./auth";
import type { ConnectionListItem } from "./types";

export type { ConnectionListItem };

export const connectionsService = {
  verifyConfig,
  createFormConnection,
  initiateRedirectAuth,
  completeRedirectAuth,
  initiateDeviceAuth,
  pollDeviceAuth,

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
        version: string;
        description?: string;
        logoUrl?: string;
        auth: { kind: string };
        capabilities?: Record<string, string>;
        userConfigSchema?: unknown;
      };
      const userConfig = row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null;
      const safeUserConfig = stripSecretFields(manifest.userConfigSchema, userConfig);
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
        userConfig: safeUserConfig,
        plugin: {
          id: pluginRow.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? "",
          auth: manifest.auth.kind,
          enabled: pluginRow.enabled === 1,
          logoUrl: manifest.logoUrl,
          capabilities: Object.keys(manifest.capabilities ?? {}),
          userConfigSchema: manifest.userConfigSchema ?? null,
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
    if (!row) throw notFound("connection.not_found", "connection not found");
    const userConfig = row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null;
    const pluginRow = await db.select().from(plugins).where(eq(plugins.id, row.pluginId)).get();
    const schema = pluginRow
      ? (JSON.parse(pluginRow.manifest) as { userConfigSchema?: unknown }).userConfigSchema
      : null;
    return stripSecretFields(schema, userConfig);
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
    if (!row) throw notFound("connection.not_found", "connection not found");
    await promoteToDefault(args.userId, row.pluginId, args.connectionId);
    await invalidateUserCache(args.userId);
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
    await invalidateUserCache(args.userId);
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
    if (!row) throw notFound("connection.not_found", "connection not found");
    const pluginRow = await db.select().from(plugins).where(eq(plugins.id, row.pluginId)).get();
    if (!pluginRow) throw badRequest("connection.plugin_missing", "plugin not installed");
    const manifest = JSON.parse(pluginRow.manifest) as { auth: { kind: string } };

    // Merge prior userConfig under the incoming payload so omitted secret fields
    // (stripped client-side via stripEmptySecrets) preserve their stored values.
    const prior =
      (row.userConfig ? (JSON.parse(row.userConfig) as Record<string, unknown>) : null) ?? {};
    const merged = {
      ...(prior as Record<string, unknown>),
      ...((args.userConfig ?? {}) as Record<string, unknown>),
    };

    if (manifest.auth.kind === "form") {
      // Re-run startAuth so credentials stay synced with userConfig changes
      // (e.g. apiKey rotation). startAuth validates upstream and returns the
      // fresh credentials blob to persist alongside.
      const result = (await pluginRuntime.runAuth(
        row.pluginId,
        "startAuth",
        args.userId,
        merged,
      )) as AuthResult;
      if (result.status !== "completed") {
        const message =
          result.status === "error" ? result.devMessage : `unexpected status: ${result.status}`;
        throw unprocessable("connection.verify_failed", `config did not verify: ${message}`, {
          message,
        });
      }
      const credEnc = await encryptJson(result.credentials);
      await db
        .update(serviceConnections)
        .set({
          userConfig: JSON.stringify(merged),
          encryptedCredentials: credEnc.data,
          credentialsIv: credEnc.iv,
          lastVerifiedAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(eq(serviceConnections.id, args.connectionId));
      await invalidateUserCache(args.userId);
      return;
    }

    const credentials = await decryptJson(row.credentialsIv, row.encryptedCredentials);
    const test = await pluginRuntime.testConnection(row.pluginId, args.userId, credentials, merged);
    if (!test.ok) {
      throw unprocessable(
        "connection.verify_failed",
        `config did not verify: ${test.message ?? "unknown"}`,
        { message: test.message ?? "unknown" },
      );
    }
    await db
      .update(serviceConnections)
      .set({
        userConfig: JSON.stringify(merged),
        lastVerifiedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(eq(serviceConnections.id, args.connectionId));
    await invalidateUserCache(args.userId);
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
    await invalidateUserCache(args.userId);
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
    const userConfig = row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null;
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
      version: string;
      description: string;
      logoUrl?: string;
      auth: string;
      hasSharedConfig: boolean;
      capabilities: string[];
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
          version: string;
          description?: string;
          logoUrl?: string;
          auth: { kind: string };
          capabilities?: Record<string, string>;
          userConfigSchema?: unknown;
          credentialsSchema?: unknown;
        };
        return {
          id: r.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? "",
          logoUrl: manifest.logoUrl,
          auth: manifest.auth.kind,
          hasSharedConfig: !!(r.sharedCredentials && r.sharedCredentialsIv),
          capabilities: Object.keys(manifest.capabilities ?? {}),
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
