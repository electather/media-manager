import { pluginError } from "@ent-mcp/plugin-sdk";
import type { Ctx, PlexMediaContainer, PlexDirectory } from "../types";
import { plexServerJson, plexServerFetch, throwIfRateLimited } from "../client";

export const libraryAdmin = {
  async refreshLibrary(ctx: unknown, input: unknown) {
    const { librarySectionId } = input as { librarySectionId?: string };
    if (librarySectionId) {
      const res = await plexServerFetch(
        ctx as Ctx,
        `/library/sections/${encodeURIComponent(librarySectionId)}/refresh`,
      );
      if (res.status === 401) throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
      throwIfRateLimited(res, ctx as Ctx);
      return { ok: res.ok };
    }
    // No section id: enumerate every section and kick a force=1 refresh on
    // each. Plex itself has no server-wide "refresh everything" endpoint.
    // `Promise.allSettled` so a mid-batch 429 or transient failure does
    // not reject the whole batch and leave later requests orphaned in
    // flight — the per-section response is reported via `ok: every .ok`.
    const body = await plexServerJson<PlexMediaContainer<{ Directory?: PlexDirectory[] }>>(
      ctx as Ctx,
      "/library/sections",
    );
    const sections = body.MediaContainer?.Directory ?? [];
    if (sections.length === 0) return { ok: true };
    const results = await Promise.allSettled(
      sections.map((s) =>
        plexServerFetch(
          ctx as Ctx,
          `/library/sections/${encodeURIComponent(s.key)}/refresh?force=1`,
        ),
      ),
    );
    // Consistency with the single-section path: if any refresh came back
    // 429, the pool must hear about it so subsequent calls back off,
    // even though `Promise.allSettled` swallows the 429 into a
    // `fulfilled` result. `ok` still reflects the aggregate success.
    const rateLimited = results.find((r) => r.status === "fulfilled" && r.value.status === 429);
    if (rateLimited && rateLimited.status === "fulfilled") {
      const retryAfterSec = Number(rateLimited.value.headers.get("Retry-After") ?? 0) || undefined;
      (ctx as Ctx).pool.markExhausted({ retryAfterSec });
    }
    return { ok: results.every((r) => r.status === "fulfilled" && r.value.ok) };
  },

  async refreshItem(ctx: unknown, input: unknown) {
    const { serverItemId } = input as { serverItemId: string };
    const res = await plexServerFetch(
      ctx as Ctx,
      `/library/metadata/${encodeURIComponent(serverItemId)}/refresh`,
      { method: "PUT" },
    );
    if (res.status === 401) throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
    throwIfRateLimited(res, ctx as Ctx);
    return { ok: res.ok };
  },
};
