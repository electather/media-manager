import type { LibraryItem } from "@ent-mcp/plugin-sdk";
import type { Ctx, PlexMediaContainer, PlexMetadata } from "../types";
import { readUserConfig, plexServerJson } from "../client";
import { toLibraryItem } from "../mappers";

export const continueWatching = {
  async getContinueWatching(ctx: unknown, input: unknown) {
    const { type, limit = 50 } = input as {
      type?: "movie" | "show";
      limit?: number;
    };
    const cfg = readUserConfig(ctx as Ctx);
    // `/hubs/continueWatching` aggregates across every directory when no
    // `contentDirectoryID` is supplied, so omitting the parameter handles
    // servers whose layout does not start at directory id `1`.
    const params = new URLSearchParams({
      "X-Plex-Container-Start": "0",
      "X-Plex-Container-Size": String(limit),
    });

    // Prefer the modern hub, but older Plex servers (<=1.20) don't expose
    // it — fall back to /library/onDeck which covers the same rows at a
    // coarser granularity.
    let metadata: PlexMetadata[] = [];
    try {
      const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
        ctx as Ctx,
        `/hubs/continueWatching?${params.toString()}`,
      );
      metadata = body.MediaContainer?.Metadata ?? [];
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        (err as { code?: string }).code === "plugin.item_not_found"
      ) {
        const fallback = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
          ctx as Ctx,
          "/library/onDeck",
        );
        metadata = fallback.MediaContainer?.Metadata ?? [];
      } else {
        throw err;
      }
    }

    const out = [];
    for (const m of metadata) {
      if (type === "movie" && m.type !== "movie") continue;
      if (type === "show" && m.type !== "episode" && m.type !== "show") continue;
      const entry: {
        item: LibraryItem;
        progressMs?: number;
        lastPlayedAt?: string;
      } = {
        item: toLibraryItem(cfg, m),
        progressMs: typeof m.viewOffset === "number" ? m.viewOffset : undefined,
        lastPlayedAt: m.lastViewedAt ? new Date(m.lastViewedAt * 1000).toISOString() : undefined,
      };
      out.push(entry);
    }
    return out;
  },
};
