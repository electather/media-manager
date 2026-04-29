import type { LibraryItem } from "@ent-mcp/plugin-sdk";
import { handleHttpStatus } from "@ent-mcp/plugin-sdk";
import type { Ctx, JellyfinSession } from "../types";
import { getUserCfg, getUserId, getExternalBase, jellyfinJson, jellyfinFetch } from "../client";
import { mapLibraryItem, ticksToMs } from "../mappers";

export const playbackSessions = {
  async getSessions(ctx: unknown, _input: unknown) {
    const typedCtx = ctx as Ctx;
    const cfg = getUserCfg(typedCtx);
    const cachedUserId = getUserId(typedCtx);
    const externalBase = getExternalBase(cfg);
    // Server-side filter so large servers don't return every session
    // over the wire. This is a payload-size hint only — the per-row
    // `session.UserId !== cachedUserId` check below remains the
    // privacy guarantee, because the server's behaviour when the
    // filter is ignored or extra entries are returned must not leak
    // other users' sessions.
    const sessions = await jellyfinJson<JellyfinSession[]>(
      typedCtx,
      `/Sessions?controllableByUserId=${encodeURIComponent(cachedUserId)}`,
    );
    const entries: Array<{
      sessionId: string;
      deviceName: string;
      clientName?: string;
      user: { id: string; name: string };
      item: LibraryItem;
      progressMs: number;
      durationMs: number;
      state: "playing" | "paused" | "buffering";
      transcoding?: {
        videoDecision: "direct-play" | "copy" | "transcode";
        audioDecision: "direct-play" | "copy" | "transcode";
        targetBitrate?: number;
        reason?: string;
      };
      startedAt: string;
    }> = [];
    for (const session of sessions ?? []) {
      // Privacy: `/Sessions` returns server-wide sessions for admin
      // tokens; drop any session that does not belong to the cached
      // user. Treat this as a guarantee, not an optimisation.
      if (!session.UserId || session.UserId !== cachedUserId) continue;
      if (!session.NowPlayingItem) continue;
      const item = mapLibraryItem(session.NowPlayingItem, externalBase);
      if (!item) continue;
      const progressMs = ticksToMs(session.PlayState?.PositionTicks);
      const durationMs = ticksToMs(session.NowPlayingItem.RunTimeTicks);
      const state: "playing" | "paused" | "buffering" = session.PlayState?.IsPaused
        ? "paused"
        : "playing";
      const entry: (typeof entries)[0] = {
        sessionId: session.Id,
        deviceName: session.DeviceName ?? "Unknown",
        clientName: session.Client,
        user: { id: session.UserId, name: session.UserName ?? "" },
        item,
        progressMs,
        durationMs,
        state,
        startedAt: session.StartTimeUtc ?? new Date(0).toISOString(),
      };
      const method = session.PlayState?.PlayMethod;
      if (session.TranscodingInfo || method) {
        const videoDecision: "direct-play" | "copy" | "transcode" =
          session.TranscodingInfo?.IsVideoDirect === true
            ? "copy"
            : method === "Transcode"
              ? "transcode"
              : "direct-play";
        const audioDecision: "direct-play" | "copy" | "transcode" =
          session.TranscodingInfo?.IsAudioDirect === true
            ? "copy"
            : method === "Transcode"
              ? "transcode"
              : "direct-play";
        entry.transcoding = {
          videoDecision,
          audioDecision,
          ...(session.TranscodingInfo?.Bitrate
            ? { targetBitrate: Math.round(session.TranscodingInfo.Bitrate / 1000) }
            : {}),
          ...(session.TranscodingInfo?.TranscodeReasons?.length
            ? { reason: session.TranscodingInfo.TranscodeReasons.join(", ") }
            : {}),
        };
      }
      entries.push(entry);
    }
    return entries;
  },

  async stopSession(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const { sessionId } = input as { sessionId: string };
    const res = await jellyfinFetch(typedCtx, `/Sessions/${sessionId}/Playing/Stop`, {
      method: "POST",
    });
    handleHttpStatus(res, "Jellyfin", { on401: "plugin.token_expired" });
    // Jellyfin stops are remote-control commands — the server always
    // accepts and forwards the request; an offline client may never
    // honour it. Surface that as `semantics: "requested"` so UIs do
    // not promise an immediate hard stop.
    return { ok: res.ok, semantics: "requested" as const };
  },
};
