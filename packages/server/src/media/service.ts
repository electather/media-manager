import {
  dispatch,
  dispatchAggregate,
  dispatchPrimary,
  dispatchSingle,
  invalidateUserCache,
} from "./dispatcher";
import { capabilityRegistry } from "../plugin-runtime/registry";
import type { CapabilityScope } from "../plugin-runtime/types";
import { PluginCallError } from "./errors";
import {
  clearPrimaryConnection,
  getPrimaryConnection,
  setPrimaryConnection,
} from "./primary-preference";
import { callExtension } from "../mcp/extension-dispatch";

/**
 * Functional facade exposing capability-driven dispatch. Most callers should use
 * the per-user `MediaService` class below; this object is what that class
 * delegates to internally and what tests/jobs can call without a user binding.
 */
export const mediaService = {
  async listProviders(
    capability: string,
    version: string,
    scope: CapabilityScope,
  ): Promise<string[]> {
    return capabilityRegistry.listProviders(capability, version, scope);
  },
  dispatch,
  dispatchSingle,
  dispatchAggregate,
  dispatchPrimary,
  invalidateUserCache,
  getPrimaryConnection,
  setPrimaryConnection,
  clearPrimaryConnection,
};

/**
 * Per-user facade. Constructed per-request with the authenticated user id;
 * every method dispatches through the strategy router, so callers never see
 * the plugin layer directly. Shapes results so the MCP tools and oRPC
 * procedures can consume arrays/objects directly.
 */
export class MediaService {
  constructor(public readonly userId: string) {}

  async search(query: string, type?: "movie" | "tv", limit?: number) {
    const result = await dispatchPrimary<Array<{ item: unknown; score?: number }>>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "search",
      input: { query, type, limit },
      mediaType: type,
    });
    return result.data ?? [];
  }

  async trending(type?: "movie" | "tv", limit?: number) {
    const result = await dispatchPrimary<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getTrending",
      input: { type, limit },
      mediaType: type,
    });
    return result.data ?? [];
  }

  async discover(filters: {
    genres?: string[];
    yearMin?: number;
    yearMax?: number;
    ratingMin?: number;
    limit?: number;
  }) {
    const result = await dispatchPrimary<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "discover",
      input: filters,
    });
    return result.data ?? [];
  }

  async getDetails(idOrCombined: string, type?: "movie" | "tv") {
    const [parsedType, parsedId] =
      type === undefined && idOrCombined.includes(":")
        ? (idOrCombined.split(":") as ["movie" | "tv", string])
        : [type ?? "movie", idOrCombined];
    const result = await dispatchPrimary<unknown>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: parsedId, type: parsedType },
      mediaType: parsedType,
    });
    return result.data ?? null;
  }

  async similar(idOrCombined: string, type?: "movie" | "tv") {
    const [parsedType, parsedId] =
      type === undefined && idOrCombined.includes(":")
        ? (idOrCombined.split(":") as ["movie" | "tv", string])
        : [type ?? "movie", idOrCombined];
    const result = await dispatchPrimary<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getSimilar",
      input: { id: parsedId, type: parsedType },
      mediaType: parsedType,
    });
    return result.data ?? [];
  }

  async recommend(limit?: number) {
    return this.getRecommendations(undefined, limit);
  }

  async requestDownload(idOrCombined: string, seasons?: string) {
    const [parsedType, parsedId] = idOrCombined.includes(":")
      ? (idOrCombined.split(":") as ["movie" | "tv", string])
      : (["movie", idOrCombined] as const);
    try {
      const result = await dispatchSingle<{
        success: boolean;
        requestId?: string;
        message?: string;
      }>({
        userId: this.userId,
        capability: "mediaRequest",
        version: "v1",
        method: "createRequest",
        input: { tmdbId: parsedId, type: parsedType, seasons },
        skipCache: true,
      });
      return result ?? { success: false, message: "no provider" };
    } catch (err) {
      if (err instanceof PluginCallError) {
        return { success: false, message: err.message };
      }
      throw err;
    }
  }

  async getRequests() {
    try {
      const result = await dispatchSingle<unknown[]>({
        userId: this.userId,
        capability: "mediaRequest",
        version: "v1",
        method: "listRequests",
        input: {},
      });
      return result ?? [];
    } catch {
      return [];
    }
  }

  async getProgress(): Promise<unknown[]> {
    // Progress is derived from watchHistory + metadata at the host layer; no
    // plugin capability covers it in v1. Returning empty keeps the MCP tool
    // happy until a dedicated capability (or host-side aggregator) lands.
    return [];
  }

  async recordFeedback(
    _id: string,
    _action: "like" | "dislike" | "rate" | "note",
    _rating?: number,
    _note?: string,
  ): Promise<void> {
    // Feedback is a host-owned concern (preference profiles, feedback_log).
    // The plugin layer does not mediate it, so this is a no-op for now.
  }

  async getHistory(limit?: number) {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: { limit },
    });
    return result.data ?? [];
  }

  async getWatchlist(type?: "movie" | "tv") {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "watchlist",
      version: "v1",
      method: "getWatchlist",
      input: { type },
    });
    return result.data ?? [];
  }

  async getUpcoming() {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "calendar",
      version: "v1",
      method: "getUpcoming",
      input: {},
    });
    return result.data ?? [];
  }

  async getRecommendations(type?: "movie" | "tv", limit?: number) {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "recommendations",
      version: "v1",
      method: "getRecommendations",
      input: { type, limit },
    });
    return result.data ?? [];
  }

  /**
   * Invokes a plugin-contributed `ext_*` MCP tool. Resolves the user's
   * connection for the given plugin, decrypts credentials, and runs the
   * plugin's `mcpTools[handlerKey]` under its sandbox. Used by the MCP
   * extension-dispatch wrapper.
   */
  async callExtension<T = unknown>(args: {
    pluginId: string;
    handlerKey: string;
    input: unknown;
    connectionId?: string;
  }): Promise<T> {
    return callExtension<T>({
      userId: this.userId,
      pluginId: args.pluginId,
      handlerKey: args.handlerKey,
      input: args.input,
      connectionId: args.connectionId,
    });
  }
}
