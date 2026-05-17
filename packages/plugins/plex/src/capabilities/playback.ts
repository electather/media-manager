import { pluginError } from "@ent-mcp/plugin-sdk";
import type { Ctx, PlexMediaContainer, PlexMetadata } from "../types";
import { readUserConfig, plexServerJson, plexServerFetch, throwIfRateLimited } from "../client";
import { toItemShape } from "../mappers";

export const playback = {
  async getPositions(ctx: unknown, input: unknown) {
    const { type } = input as { type?: "movie" | "tv" };
    const cfg = readUserConfig(ctx as Ctx);
    const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
      ctx as Ctx,
      "/library/onDeck",
    );
    const metadata = body.MediaContainer?.Metadata ?? [];
    const results = [];
    for (const m of metadata) {
      if (type === "movie" && m.type !== "movie") continue;
      if (type === "tv" && m.type !== "episode" && m.type !== "show") continue;
      const duration = m.duration ?? 0;
      const offset = m.viewOffset ?? 0;
      const progress = duration > 0 ? Math.min(100, Math.round((offset / duration) * 100)) : 0;
      // Unix-epoch sentinel for missing `lastViewedAt`: the capability
      // schema requires `pausedAt: string`, so the sentinel keeps the
      // response schema-valid. Callers sorting by `pausedAt` see
      // unknown-timestamp rows at the start of time.
      const pausedAt = m.lastViewedAt
        ? new Date(m.lastViewedAt * 1000).toISOString()
        : new Date(0).toISOString();
      results.push({
        item: toItemShape(cfg, m),
        progress,
        pausedAt,
        season: m.parentIndex,
        episode: m.index,
        playbackId: m.ratingKey,
      });
    }
    return results;
  },

  async removePosition(ctx: unknown, input: unknown) {
    const { playbackId } = input as { playbackId: string };
    // Plex exposes "forget the current offset" via /:/unscrobble with the
    // item's ratingKey. 200/204 both mean success; 404 means the item is
    // unknown (already cleared) — treat as idempotent.
    const params = new URLSearchParams({
      identifier: "com.plexapp.plugins.library",
      key: playbackId,
    });
    const res = await plexServerFetch(ctx as Ctx, `/:/unscrobble?${params.toString()}`);
    if (res.status === 401) throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
    throwIfRateLimited(res, ctx as Ctx);
    if (res.status >= 500)
      throw pluginError("plugin.upstream_error", `Plex server error (${res.status})`);
    return { ok: res.ok || res.status === 404 };
  },
};
