import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections, pendingAuth, plugins } from "../db/schema";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { sharedCredentialsService } from "../plugin-runtime/shared-credentials";
import type { CapabilityScope, ManifestCapability, PluginManifest } from "@ent-mcp/shared/plugins";
import type { ConnectionListItem } from "@ent-mcp/shared/connections";
import type { AuthResult } from "@ent-mcp/plugin-sdk";
import { invalidateUserCache } from "../media/dispatcher";
import { badRequest, notFound, unprocessable } from "../errors/http-errors";
import {
  computeDisplayFields,
  decryptJson,
  encryptJson,
  promoteToDefault,
  stripRequestFields,
  stripResponseFields,
} from "./helpers";
import {
  applyUserConfigPatch,
  verifyConfig,
  createFormConnection,
  initiateRedirectAuth,
  completeRedirectAuth,
  initiateDeviceAuth,
  pollDeviceAuth,
} from "./auth";

type StoredManifest = Pick<
  PluginManifest,
  | "name"
  | "version"
  | "description"
  | "logoUrl"
  | "auth"
  | "capabilities"
  | "userConfigSchema"
  | "credentialsSchema"
  | "poolable"
>;

function parseManifest(raw: string): StoredManifest {
  return JSON.parse(raw) as StoredManifest;
}

function capabilitiesAtScope(
  manifest: StoredManifest,
  scope: CapabilityScope,
): Array<{ id: string; version: string }> {
  const entries: Array<[string, ManifestCapability]> = Object.entries(manifest.capabilities);
  return entries
    .filter(([, cap]) => cap.scope === scope)
    .map(([id, cap]) => ({ id, version: cap.version }));
}

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

    // De-duplicate per-plugin work across rows so a user with N connections
    // to the same plugin doesn't pay for N plugin lookups + N pool counts.
    // The cache lives only for the duration of this call — fresh on every
    // request so admin-side mutations are picked up.
    const pluginCache = new Map<string, Promise<typeof plugins.$inferSelect | undefined>>();
    const adminSharedCache = new Map<string, Promise<boolean>>();
    const fetchPlugin = (pluginId: string) => {
      const hit = pluginCache.get(pluginId);
      if (hit) return hit;
      const promise = db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
      pluginCache.set(pluginId, promise);
      return promise;
    };
    const fetchAdminShared = (pluginId: string) => {
      const hit = adminSharedCache.get(pluginId);
      if (hit) return hit;
      const promise = sharedCredentialsService.countEnabled(pluginId).then((n) => n > 0);
      adminSharedCache.set(pluginId, promise);
      return promise;
    };

    const result: ConnectionListItem[] = [];
    for (const row of rows) {
      const pluginRow = await fetchPlugin(row.pluginId);
      // Skip orphaned (uninstalled) plugins, and disabled ones — the latter
      // matches the design doc's claim that `/connections/` only surfaces
      // connections to currently-enabled plugins.
      if (!pluginRow) continue;
      if (pluginRow.enabled !== 1) continue;
      const manifest = parseManifest(pluginRow.manifest);
      const userConfig = row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null;
      const adminSharedAvailable = await fetchAdminShared(pluginRow.id);
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
        displayFields: computeDisplayFields(manifest.userConfigSchema, userConfig),
        plugin: {
          id: pluginRow.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? "",
          logoUrl: manifest.logoUrl,
          authKind: manifest.auth.kind,
          poolable: manifest.poolable ?? false,
          userScopedCapabilities: capabilitiesAtScope(manifest, "user"),
          globalScopedCapabilities: capabilitiesAtScope(manifest, "global"),
          userConfigSchema: (manifest.userConfigSchema as Record<string, unknown>) ?? null,
          credentialsSchema: (manifest.credentialsSchema as Record<string, unknown>) ?? null,
          adminSharedAvailable,
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
    const pluginRow = await db.select().from(plugins).where(eq(plugins.id, row.pluginId)).get();
    // An orphaned connection (its plugin was uninstalled) must not return its
    // `userConfig`: without the manifest we cannot identify which fields carry
    // `x-private` / `x-secret`, so stripping would silently pass them through.
    // Surface the inconsistency instead — the caller should reconnect or the
    // operator should delete the row.
    if (!pluginRow) throw notFound("connection.plugin_missing", "plugin not installed");
    const userConfig = row.userConfig ? (JSON.parse(row.userConfig) as unknown) : null;
    const schema = parseManifest(pluginRow.manifest).userConfigSchema;
    return stripResponseFields(schema, userConfig);
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
    const manifest = parseManifest(pluginRow.manifest);

    // Merge prior userConfig under the incoming payload so omitted stripped
    // fields (`x-secret` or `x-private`, never sent to the client and therefore
    // absent from the edit form) preserve their stored values. `x-plugin-
    // resolved` fields are dropped from the *incoming* payload before the
    // merge so a client cannot overwrite a plugin-owned field; the prior
    // stored value (resolved by the plugin on the last auth round-trip) is
    // what ends up in `merged`.
    const prior =
      (row.userConfig ? (JSON.parse(row.userConfig) as Record<string, unknown>) : null) ?? {};
    const sanitizedIncoming = (stripRequestFields(manifest.userConfigSchema, args.userConfig) ??
      {}) as Record<string, unknown>;
    const merged = {
      ...(prior as Record<string, unknown>),
      ...sanitizedIncoming,
    };

    if (manifest.auth.kind === "form") {
      // Re-run startAuth so credentials stay synced with userConfig changes
      // (e.g. apiKey rotation). startAuth validates upstream and returns the
      // fresh credentials blob to persist alongside. Decrypt prior credentials
      // and pass them into runAuth so plugins that keep secrets out of
      // userConfig (e.g. Jellyfin's password lives in the encrypted
      // credentials blob) can rehydrate them via ctx.credentials on re-auth.
      const priorCredentials = await decryptJson(row.credentialsIv, row.encryptedCredentials);
      const result = (await pluginRuntime.runAuth(
        row.pluginId,
        "startAuth",
        args.userId,
        merged,
        undefined,
        priorCredentials,
      )) as AuthResult;
      if (result.status !== "completed") {
        const message =
          result.status === "error" ? result.devMessage : `unexpected status: ${result.status}`;
        const field =
          result.status === "error" && typeof result.params?.field === "string"
            ? result.params.field
            : undefined;
        throw unprocessable("connection.verify_failed", `config did not verify: ${message}`, {
          message,
          ...(field ? { field } : {}),
        });
      }
      // Merge any plugin-returned patch (e.g. Jellyfin's `userId` from
      // `/Users/Me`) on top of the incoming userConfig so re-auth refreshes
      // server-resolved identifiers without the client having to round-trip.
      // `null` patch values mean "delete this key" — used to strip secrets
      // that the plugin has promoted into the encrypted credentials blob.
      const patched = applyUserConfigPatch(merged, result.userConfigPatch);
      const credEnc = await encryptJson(result.credentials);
      await db
        .update(serviceConnections)
        .set({
          userConfig: JSON.stringify(patched),
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

  /**
   * Plugins a user can create a connection for. Filters to plugins that expose
   * at least one user-scoped capability — pure-global plugins (TMDB v2, TVDB
   * v2) have no user-side surface and are excluded.
   */
  async listAvailablePlugins(): Promise<
    Array<{
      id: string;
      name: string;
      version: string;
      description: string;
      logoUrl?: string;
      authKind: PluginManifest["auth"]["kind"];
      poolable: boolean;
      adminSharedAvailable: boolean;
      userScopedCapabilities: Array<{ id: string; version: string }>;
      globalScopedCapabilities: Array<{ id: string; version: string }>;
      userConfigSchema: Record<string, unknown> | null;
      credentialsSchema: Record<string, unknown> | null;
    }>
  > {
    const db = getDb();
    const rows = await db.select().from(plugins).where(eq(plugins.enabled, 1)).all();
    const out: Awaited<ReturnType<typeof connectionsService.listAvailablePlugins>> = [];
    for (const row of rows) {
      if (!capabilityRegistry.get(row.id)) continue;
      const manifest = parseManifest(row.manifest);
      const userScoped = capabilitiesAtScope(manifest, "user");
      if (userScoped.length === 0) continue;
      const adminSharedAvailable = (await sharedCredentialsService.countEnabled(row.id)) > 0;
      out.push({
        id: row.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? "",
        logoUrl: manifest.logoUrl,
        authKind: manifest.auth.kind,
        poolable: manifest.poolable ?? false,
        adminSharedAvailable,
        userScopedCapabilities: userScoped,
        globalScopedCapabilities: capabilitiesAtScope(manifest, "global"),
        userConfigSchema: (manifest.userConfigSchema as Record<string, unknown>) ?? null,
        credentialsSchema: (manifest.credentialsSchema as Record<string, unknown>) ?? null,
      });
    }
    return out;
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
