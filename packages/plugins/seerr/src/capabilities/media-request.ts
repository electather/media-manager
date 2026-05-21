import { isPluginError, pluginError } from "@ent-mcp/plugin-sdk";
import { seerrGet, seerrPost, seerrDeleteRaw, fetchAllRequests, isHostActionable } from "../client";
import { mapMediaStatus, mapRequestStatus } from "../mappers";
import { REQUEST_STATUS_STORE_KEY } from "../constants";
import type { Ctx } from "../types";

function assertNonNegativeIntId(id: string, label: string): void {
  if (!/^\d+$/.test(id)) {
    throw pluginError(
      "plugin.input_invalid",
      `invalid ID: must be a non-negative integer (${label})`,
    );
  }
}

/**
 * Per-connection job that detects request-status transitions in Seerr and
 * emits `media.request.available` / `media.request.denied` events.
 *
 * State is kept in `ctx.store` keyed per connection (the host scopes the
 * store by user automatically). On the first run for a connection no events
 * fire — the job simply records the baseline. Subsequent runs emit when a
 * request transitions into the `available` or `failed` terminal states.
 *
 * Emits run via `ctx.notify` so the host's `emit()` handles enrichment,
 * permission gating, and delivery scheduling. Emit failures are logged by
 * the host wrapper and do not break the sweep.
 */
export async function syncRequestStatuses(ctx: Ctx): Promise<void> {
  if (!ctx.userId) return;

  const prior = ((await ctx.store.get(REQUEST_STATUS_STORE_KEY, { scope: "user" })) ??
    {}) as Record<string, string>;
  const requests = await fetchAllRequests(ctx);
  const next: Record<string, string> = {};
  const isFirstRun = Object.keys(prior).length === 0;

  for (const row of requests) {
    const id = String(row.id);
    const status = mapRequestStatus(row.status);
    next[id] = status;

    if (isFirstRun) continue;
    if (prior[id] === status) continue;

    const title = row.media.title ?? row.media.originalTitle ?? "";
    const mediaId = String(row.media.tmdbId);
    const posterUrl = row.media.posterPath
      ? `https://image.tmdb.org/t/p/w500${row.media.posterPath}`
      : undefined;

    if (status === "available") {
      await ctx.notify({
        type: "media.request.available",
        category: "media",
        severity: "info",
        audience: { kind: "user", userId: ctx.userId },
        payload: { requestId: id, mediaId, title, ...(posterUrl ? { posterUrl } : {}) },
      });
    } else if (status === "failed") {
      await ctx.notify({
        type: "media.request.denied",
        category: "media",
        severity: "warn",
        audience: { kind: "user", userId: ctx.userId },
        payload: { requestId: id, mediaId, title, ...(posterUrl ? { posterUrl } : {}) },
      });
    }
  }

  await ctx.store.set(REQUEST_STATUS_STORE_KEY, next, { scope: "user" });
}

export const mediaRequest = {
  async checkAvailability(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { tmdbId, type } = input as { tmdbId: string; type: "movie" | "tv" };
    assertNonNegativeIntId(tmdbId, "tmdbId");
    const path = type === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
    try {
      const data = await seerrGet<{ mediaInfo?: { status: number } }>(c, path);
      if (!data.mediaInfo) return { status: "unavailable" };
      return { status: mapMediaStatus(data.mediaInfo.status) };
    } catch (err) {
      // Token expiry, bad creds, and rate limits must escape so the host
      // can refresh or back off. Everything else (404, upstream 5xx,
      // timeout, …) collapses to a "unknown" availability hint.
      if (isHostActionable(err)) throw err;
      if (isPluginError(err)) return { status: "unknown" };
      throw err;
    }
  },

  async createRequest(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { tmdbId, type, seasons, targetId, profileId } = input as {
      tmdbId: string;
      type: "movie" | "tv";
      seasons?: string;
      targetId?: string;
      profileId?: string;
    };
    assertNonNegativeIntId(tmdbId, "tmdbId");
    if (targetId !== undefined) assertNonNegativeIntId(targetId, "targetId");
    if (profileId !== undefined) assertNonNegativeIntId(profileId, "profileId");
    const body: Record<string, unknown> = {
      mediaType: type,
      mediaId: Number(tmdbId),
    };
    if (type === "tv" && seasons) {
      body["seasons"] = seasons
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
    }
    if (targetId) body["serverId"] = Number(targetId);
    // Overseerr/Seerr expects `profileId` at the top level of the POST body
    // alongside `serverId` (not nested under a `profiles` object). The
    // `profileId`/`profile_id` aliases differ across versions; both are
    // emitted defensively so older Overseerr deployments still honour the
    // override instead of silently falling back to the server default.
    if (profileId) {
      body["profileId"] = Number(profileId);
    }
    try {
      const data = await seerrPost<{ id: number }>(c, "/request", body);
      return { success: true, requestId: String(data.id) };
    } catch (err) {
      // Token expiry and rate limits must escape so the host can refresh
      // credentials or back off — swallowing them strands the session.
      if (isHostActionable(err)) throw err;
      if (isPluginError(err)) return { success: false, message: err.message };
      return { success: false, message: String(err) };
    }
  },

  async listTargets(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type } = input as { type: "movie" | "tv" };
    const root = type === "movie" ? "/service/radarr" : "/service/sonarr";
    try {
      const servers = await seerrGet<
        Array<{ id: number; name: string; activeProfileId?: number | null }>
      >(c, root);
      const targets: Array<{
        targetId: string;
        label: string;
        exposesProfiles: boolean;
        defaultProfileId: string | null;
        profiles: Array<{ id: string; label: string }>;
      }> = [];
      for (const server of servers) {
        try {
          const detail = await seerrGet<{
            profiles?: Array<{ id: number; name: string }>;
          }>(c, `${root}/${server.id}`);
          targets.push({
            targetId: String(server.id),
            label: server.name,
            exposesProfiles: true,
            defaultProfileId:
              server.activeProfileId != null ? String(server.activeProfileId) : null,
            profiles: (detail.profiles ?? []).map((p) => ({
              id: String(p.id),
              label: p.name,
            })),
          });
        } catch (err) {
          // A single misbehaving server detail must not blank the whole list.
          if (isHostActionable(err)) throw err;
          // Skip this server; surface what we can.
        }
      }
      return { targets };
    } catch (err) {
      if (isHostActionable(err)) throw err;
      return { targets: [] };
    }
  },

  async cancelRequest(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { requestId } = input as { requestId: string };
    assertNonNegativeIntId(requestId, "requestId");
    try {
      // Use seerrDeleteRaw so 404 is not converted into a thrown error —
      // Seerr returns 204 on success and 404 when the row has already
      // been removed. Both are idempotent success from the caller's
      // perspective. 401/429/5xx still throw via the helper.
      const res = await seerrDeleteRaw(c, `/request/${requestId}`);
      if (res.ok || res.status === 404) return { ok: true };
      return { ok: false, message: `Seerr ${res.status}` };
    } catch (err) {
      if (isHostActionable(err)) throw err;
      if (isPluginError(err)) return { ok: false, message: err.message };
      return { ok: false, message: String(err) };
    }
  },

  async listRequests(ctx: unknown, _input: unknown) {
    const c = ctx as Ctx;
    const all = await fetchAllRequests(c);
    // Absent `seasons` on a TV row signals an upstream field rename; .find() stops at the first match so the warn fires at most once per call regardless of how many rows are affected.
    const firstBadTvRow = all.find((r) => r.type === "tv" && !Array.isArray(r.seasons));
    if (firstBadTvRow) {
      c.log.warn("seerr.listRequests: tv row missing `seasons` array — possible upstream rename", {
        keys: Object.keys(firstBadTvRow),
      });
    }
    return all.map((r) => ({
      id: String(r.id),
      tmdbId: String(r.media.tmdbId),
      type: r.type,
      title: r.media.title ?? r.media.originalTitle ?? "",
      status: mapRequestStatus(r.status),
      createdAt: r.createdAt,
      seasons: r.seasons?.map((s) => s.seasonNumber) ?? [],
      targetLabel: r.serverName ?? null,
      profileLabel: r.profileName ?? null,
    }));
  },
};
