import { pluginError } from "@nama/plugin-sdk";
import type { Ctx, PlexMediaContainer, PlexMetadata } from "../types";
import { readUserConfig, plexServerJson, plexServerFetch, throwIfRateLimited } from "../client";
import { toItemShape, extractRatingKey } from "../mappers";

export const watchHistory = {
  async getHistory(ctx: unknown, input: unknown) {
    const { since } = input as { since?: string };
    const cfg = readUserConfig(ctx as Ctx);
    // Build the query manually for the `viewedAt>` key: URLSearchParams
    // percent-encodes `>` to `%3E`, but Plex's filter syntax requires
    // the literal `>` character in the key (`?viewedAt>=<unix_ts>`), so
    // routing it through URLSearchParams silently drops the filter on
    // some PMS builds and returns every row regardless of `since`.
    const accountQs = cfg.plexAccountId ? `accountID=${encodeURIComponent(cfg.plexAccountId)}` : "";
    let sinceQs = "";
    if (since) {
      const t = Math.floor(new Date(since).getTime() / 1000);
      if (!Number.isNaN(t)) sinceQs = `viewedAt>=${t}`;
    }
    const parts = [accountQs, sinceQs].filter(Boolean);
    const path =
      parts.length > 0
        ? `/status/sessions/history/all?${parts.join("&")}`
        : "/status/sessions/history/all";
    const body = await plexServerJson<
      PlexMediaContainer<{
        Metadata?: Array<PlexMetadata & { viewedAt?: number }>;
      }>
    >(ctx as Ctx, path);
    const rows = body.MediaContainer?.Metadata ?? [];
    return rows.map((r) => ({
      item: toItemShape(cfg, r),
      watchedAt: r.viewedAt ? new Date(r.viewedAt * 1000).toISOString() : "",
      progress: 100,
    }));
  },

  async addToHistory(ctx: unknown, input: unknown) {
    const items = input as Array<{
      id?: string;
      ids?: { plex_ratingKey?: string };
      type: string;
    }>;
    let added = 0;
    for (const item of items) {
      const ratingKey = extractRatingKey(item);
      if (!ratingKey) continue;
      const params = new URLSearchParams({
        identifier: "com.plexapp.plugins.library",
        key: ratingKey,
      });
      const res = await plexServerFetch(ctx as Ctx, `/:/scrobble?${params.toString()}`);
      if (res.status === 401) throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
      throwIfRateLimited(res, ctx as Ctx);
      if (res.ok || res.status === 404) added += 1;
    }
    return { added };
  },

  async removeFromHistory(ctx: unknown, input: unknown) {
    const items = input as Array<{
      id?: string;
      ids?: { plex_ratingKey?: string };
      type: string;
    }>;
    let removed = 0;
    for (const item of items) {
      const ratingKey = extractRatingKey(item);
      if (!ratingKey) continue;
      const params = new URLSearchParams({
        identifier: "com.plexapp.plugins.library",
        key: ratingKey,
      });
      const res = await plexServerFetch(ctx as Ctx, `/:/unscrobble?${params.toString()}`);
      if (res.status === 401) throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
      throwIfRateLimited(res, ctx as Ctx);
      if (res.ok || res.status === 404) removed += 1;
    }
    return { removed };
  },
};
