import { pluginError } from "@ent-mcp/plugin-sdk";
import type { Ctx, PlexMediaContainer, PlexSession } from "../types";
import { readUserConfig, plexServerJson, plexServerFetch, throwIfRateLimited } from "../client";
import { toLibraryItem, normalizeSessionState, normalizeDecision } from "../mappers";

export const playbackSessions = {
  async getSessions(ctx: unknown, _input: unknown) {
    const cfg = readUserConfig(ctx as Ctx);
    const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexSession[] }>>(
      ctx as Ctx,
      "/status/sessions",
    );
    const sessions = body.MediaContainer?.Metadata ?? [];
    const out = [];
    for (const s of sessions) {
      // Privacy guarantee: drop sessions whose User.id does not match the
      // connection's own account id, even if the Plex token could technically
      // see them. `plexAccountId` is cached at auth time — if it's missing
      // (older connections, auth that could not reach /user), keep the
      // session since we cannot verify ownership and stripping everything
      // would make the capability unusable for those users.
      if (cfg.plexAccountId && s.User?.id && String(s.User.id) !== cfg.plexAccountId) {
        continue;
      }
      const sessionId = s.Session?.id ?? s.sessionKey;
      if (!sessionId) continue;
      out.push({
        sessionId: String(sessionId),
        deviceName: s.Player?.title ?? "unknown",
        clientName: s.Player?.product,
        user: {
          id: String(s.User?.id ?? ""),
          name: s.User?.title ?? "",
        },
        item: toLibraryItem(cfg, s),
        progressMs: s.viewOffset ?? 0,
        durationMs: s.duration ?? 0,
        state: normalizeSessionState(s.Player?.state),
        transcoding: s.TranscodeSession
          ? {
              videoDecision: normalizeDecision(s.TranscodeSession.videoDecision),
              audioDecision: normalizeDecision(s.TranscodeSession.audioDecision),
              targetBitrate: s.TranscodeSession.targetBitrate,
              reason: s.TranscodeSession.transcodeReason,
            }
          : undefined,
        // `startedAt` is a required string on the capability schema, but
        // Plex's `/status/sessions` does not expose the session-start
        // timestamp. Emit the Unix epoch as a schema-valid sentinel so
        // callers can detect "unknown" rather than silently receive a
        // fabricated value; promoting the schema to an optional field is
        // tracked separately.
        startedAt: new Date(0).toISOString(),
      });
    }
    return out;
  },

  async stopSession(ctx: unknown, input: unknown) {
    const { sessionId, reason } = input as { sessionId: string; reason?: string };
    const params = new URLSearchParams({ sessionId });
    if (reason) params.set("reason", reason);
    const res = await plexServerFetch(
      ctx as Ctx,
      `/status/sessions/terminate?${params.toString()}`,
      { method: "DELETE" },
    );
    if (res.status === 401) throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
    throwIfRateLimited(res, ctx as Ctx);
    if (res.status >= 500)
      throw pluginError("plugin.upstream_error", `Plex server error (${res.status})`);
    // 404 means the session already ended; treat as idempotent success so
    // a double-click on "stop" does not surface a spurious failure.
    return { ok: res.ok || res.status === 404, semantics: "forced" as const };
  },
};
