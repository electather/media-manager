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
    // plexAccountId is required — without it the query returns every account's
    // history on the server, leaking other users' data (#929). Enforced at
    // runtime not via userConfigSchema.required so pre-#929 connections fail
    // loud here instead of bricking at config validation; diverges from
    // getSessions' fallback because leaking history is worse than sessions.
    if (!cfg.plexAccountId)
      throw pluginError(
        "plugin.bad_credentials",
        "Re-authenticate your Plex connection to restore watch history sync (plexAccountId not resolved at setup)",
      );
    const accountQs = `accountID=${encodeURIComponent(cfg.plexAccountId)}`;
    let sinceQs = "";
    if (since) {
      const t = Math.floor(new Date(since).getTime() / 1000);
      if (!Number.isNaN(t)) sinceQs = `viewedAt>=${t}`;
    }
    const qs = [accountQs, sinceQs].filter(Boolean).join("&");
    const path = `/status/sessions/history/all?${qs}`;
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
