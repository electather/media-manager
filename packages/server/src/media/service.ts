import { and, eq, desc } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections, plugins } from "../db/schema";
import { env } from "../env";
import { decrypt } from "../crypto/vault";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { pluginRuntime } from "../plugin-runtime/runtime";

export interface ResolvedConnection {
  id: string;
  pluginId: string;
  credentials: unknown;
  userConfig: unknown;
}

async function decryptField(iv: string | null, data: string | null): Promise<unknown> {
  if (!iv || !data) return null;
  const plain = await decrypt(`${iv}:${data}`, env.ENCRYPTION_KEY);
  try {
    return JSON.parse(plain);
  } catch {
    return plain;
  }
}

/** Returns the default enabled connection for (user, plugin), or null when none exists. */
async function getDefaultConnection(
  userId: string,
  pluginId: string,
): Promise<ResolvedConnection | null> {
  const db = getDb();
  const row = await db
    .select()
    .from(serviceConnections)
    .where(
      and(
        eq(serviceConnections.userId, userId),
        eq(serviceConnections.pluginId, pluginId),
        eq(serviceConnections.enabled, 1),
      ),
    )
    .orderBy(desc(serviceConnections.isDefault))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    pluginId: row.pluginId,
    credentials: await decryptField(row.credentialsIv, row.encryptedCredentials),
    userConfig: await decryptField(row.userConfigIv, row.encryptedUserConfig),
  };
}

async function hasGlobalConfig(pluginId: string): Promise<boolean> {
  const db = getDb();
  const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
  return !!(row?.globalConfig && row.globalConfigIv);
}

export interface ProviderResult<T = unknown> {
  pluginId: string;
  result?: T;
  error?: { code: string; message: string };
}

export interface DispatchArgs {
  userId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  /** Restrict fan-out / first-provider to this subset of plugin ids. */
  allowedProviders?: string[];
}

/**
 * Functional service layer over the plugin runtime. All cross-plugin logic lives here:
 * selecting the user's default connection, shared-key fallback, provider listing, and
 * single/first/fan-out dispatch patterns.
 */
export const mediaService = {
  async listProviders(capability: string, version: string): Promise<string[]> {
    return capabilityRegistry.listProviders(capability, version);
  },

  async dispatchOne<T = unknown>(args: {
    userId: string;
    pluginId: string;
    capability: string;
    version: string;
    method: string;
    input: unknown;
  }): Promise<T> {
    const conn = await getDefaultConnection(args.userId, args.pluginId);
    const fallbackAllowed = conn === null && (await hasGlobalConfig(args.pluginId));
    if (!conn && !fallbackAllowed) {
      throw new Error(`no connection for plugin ${args.pluginId}`);
    }
    return pluginRuntime.invoke<T>({
      pluginId: args.pluginId,
      capability: args.capability,
      version: args.version,
      method: args.method,
      input: args.input,
      userId: args.userId,
      credentials: conn?.credentials,
      userConfig: conn?.userConfig,
    });
  },

  /** Calls the first provider that succeeds. */
  async first<T = unknown>(args: DispatchArgs): Promise<ProviderResult<T>> {
    const providers = capabilityRegistry.listProviders(args.capability, args.version);
    const candidates = args.allowedProviders
      ? providers.filter((p) => args.allowedProviders!.includes(p))
      : providers;
    let lastError: { code: string; message: string } | undefined;
    for (const pluginId of candidates) {
      try {
        const result = await this.dispatchOne<T>({
          userId: args.userId,
          pluginId,
          capability: args.capability,
          version: args.version,
          method: args.method,
          input: args.input,
        });
        return { pluginId, result };
      } catch (err) {
        lastError = {
          code: "UPSTREAM_ERROR",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return {
      pluginId: candidates[0] ?? "",
      error: lastError ?? { code: "NO_PROVIDER", message: "no plugin provides this capability" },
    };
  },

  /** Fans out to every provider. One result or error per plugin. */
  async fanOut<T = unknown>(args: DispatchArgs): Promise<ProviderResult<T>[]> {
    const providers = capabilityRegistry.listProviders(args.capability, args.version);
    const candidates = args.allowedProviders
      ? providers.filter((p) => args.allowedProviders!.includes(p))
      : providers;
    return Promise.all(
      candidates.map(async (pluginId) => {
        try {
          const result = await this.dispatchOne<T>({
            userId: args.userId,
            pluginId,
            capability: args.capability,
            version: args.version,
            method: args.method,
            input: args.input,
          });
          return { pluginId, result };
        } catch (err) {
          return {
            pluginId,
            error: {
              code: "UPSTREAM_ERROR",
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }),
    );
  },
};

/**
 * Per-user facade. Constructed per-request with the authenticated user id; delegates
 * to {@link mediaService} and shapes results for the MCP tools and oRPC procedures.
 */
export class MediaService {
  constructor(public readonly userId: string) {}

  async search(query: string, type?: "movie" | "tv", limit?: number) {
    const res = await mediaService.first<Array<{ item: unknown; score?: number }>>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "search",
      input: { query, type, limit },
    });
    return res.result ?? [];
  }

  async trending(type?: "movie" | "tv", limit?: number) {
    const res = await mediaService.first<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getTrending",
      input: { type, limit },
    });
    return res.result ?? [];
  }

  async discover(filters: {
    genres?: string[];
    yearMin?: number;
    yearMax?: number;
    ratingMin?: number;
    limit?: number;
  }) {
    const res = await mediaService.first<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "discover",
      input: filters,
    });
    return res.result ?? [];
  }

  async getDetails(idOrCombined: string, type?: "movie" | "tv") {
    const [parsedType, parsedId] =
      type === undefined && idOrCombined.includes(":")
        ? (idOrCombined.split(":") as ["movie" | "tv", string])
        : [type ?? "movie", idOrCombined];
    const res = await mediaService.first<unknown>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: parsedId, type: parsedType },
    });
    return res.result ?? null;
  }

  async similar(idOrCombined: string, type?: "movie" | "tv") {
    const [parsedType, parsedId] =
      type === undefined && idOrCombined.includes(":")
        ? (idOrCombined.split(":") as ["movie" | "tv", string])
        : [type ?? "movie", idOrCombined];
    const res = await mediaService.first<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getSimilar",
      input: { id: parsedId, type: parsedType },
    });
    return res.result ?? [];
  }

  async recommend(limit?: number) {
    return this.getRecommendations(undefined, limit);
  }

  async requestDownload(idOrCombined: string, seasons?: string) {
    const [parsedType, parsedId] = idOrCombined.includes(":")
      ? (idOrCombined.split(":") as ["movie" | "tv", string])
      : (["movie", idOrCombined] as const);
    const res = await mediaService.first<{
      success: boolean;
      requestId?: string;
      message?: string;
    }>({
      userId: this.userId,
      capability: "mediaRequest",
      version: "v1",
      method: "createRequest",
      input: { tmdbId: parsedId, type: parsedType, seasons },
    });
    return res.result ?? { success: false, message: res.error?.message ?? "no provider" };
  }

  async getRequests() {
    const res = await mediaService.first<unknown[]>({
      userId: this.userId,
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });
    return res.result ?? [];
  }

  async getProgress(): Promise<unknown[]> {
    // Progress is derived from watchHistory + metadata at the host layer; no plugin
    // capability covers it in v1. Returning an empty array keeps the MCP tool happy.
    return [];
  }

  async recordFeedback(
    _id: string,
    _action: "like" | "dislike" | "rate" | "note",
    _rating?: number,
    _note?: string,
  ): Promise<void> {
    // Feedback is a host-owned concern (preference profiles, feedback_log). The plugin
    // layer does not mediate it, so this is a no-op at the service level for now.
  }

  async getHistory(limit?: number) {
    const res = await mediaService.first<unknown[]>({
      userId: this.userId,
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: { limit },
    });
    return res.result ?? [];
  }

  async getWatchlist(type?: "movie" | "tv") {
    const res = await mediaService.first<unknown[]>({
      userId: this.userId,
      capability: "watchlist",
      version: "v1",
      method: "getWatchlist",
      input: { type },
    });
    return res.result ?? [];
  }

  async getUpcoming() {
    const res = await mediaService.first<unknown[]>({
      userId: this.userId,
      capability: "calendar",
      version: "v1",
      method: "getUpcoming",
      input: {},
    });
    return res.result ?? [];
  }

  async getRecommendations(type?: "movie" | "tv", limit?: number) {
    const res = await mediaService.first<unknown[]>({
      userId: this.userId,
      capability: "recommendations",
      version: "v1",
      method: "getRecommendations",
      input: { type, limit },
    });
    return res.result ?? [];
  }
}
