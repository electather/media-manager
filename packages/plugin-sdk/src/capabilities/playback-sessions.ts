import { z } from "zod";
import { libraryItemSchema } from "@nama/shared/plugins/library";
import { defineCapability, method } from "../define";

const sessionTranscodingDecision = z.enum(["direct-play", "copy", "transcode"]);

const sessionState = z.enum(["playing", "paused", "buffering"]);

const sessionTranscoding = z.object({
  videoDecision: sessionTranscodingDecision,
  audioDecision: sessionTranscodingDecision,
  /** Target bitrate in kbps when the server is transcoding. */
  targetBitrate: z.number().optional(),
  /** Server-reported reason for the transcode (e.g. "audio codec mismatch"). */
  reason: z.string().optional(),
});

// Server-local user identity. Distinct from the nama user running the
// query — a Plex home-user or a Jellyfin managed user may be the one actually
// playing, even though the connection is authed as the owning account. Plugins
// MUST only return sessions for users the connection is allowed to see and
// MUST drop sessions from other accounts even when the underlying token could
// see them (see design doc for per-server filtering rules).
const sessionUser = z.object({
  id: z.string(),
  name: z.string(),
});

const sessionEntry = z.object({
  sessionId: z.string().min(1),
  deviceName: z.string(),
  /** e.g. "Plex for iOS", "Jellyfin Web"; absent when the server does not expose it. */
  clientName: z.string().optional(),
  user: sessionUser,
  item: libraryItemSchema,
  progressMs: z.number(),
  durationMs: z.number(),
  state: sessionState,
  transcoding: sessionTranscoding.optional(),
  /** ISO timestamp playback started on this session. */
  startedAt: z.string(),
});

export type SessionEntry = z.infer<typeof sessionEntry>;

const stopSessionInput = z.object({
  sessionId: z.string().min(1),
  /** Optional human-readable reason surfaced to the player (Jellyfin only). */
  reason: z.string().optional(),
});

// "forced" — Plex terminates server-side and the session disappears on next
// getSessions. "requested" — Jellyfin sends a remote-control command that the
// client may ignore if offline/unresponsive. UIs should phrase the
// confirmation accordingly instead of assuming an immediate hard stop.
const stopSessionSemantics = z.enum(["forced", "requested"]);

const stopSessionOutput = z.object({
  ok: z.boolean(),
  semantics: stopSessionSemantics,
});

/**
 * playbackSessions@v1 — currently-playing sessions across the user's media
 * servers, plus a per-session stop action. Transcoding details ride inline on
 * each session so a dedicated `transcoding@v1` capability is unnecessary.
 *
 * Distinct from `playback@v1`, which returns historical resume positions from
 * sync APIs (Trakt). Sessions here are live, server-observed, and short-lived.
 *
 * No `mcpTools` in this revision — they land with the Plex/Jellyfin plugin
 * implementations (#22, #23).
 */
export const PlaybackSessionsV1 = defineCapability({
  id: "playbackSessions",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 30,
  negativeCacheTtlSec: 15,
  defaultTimeoutMs: 15_000,
  methods: {
    getSessions: method(z.object({}), z.array(sessionEntry)),
    stopSession: method(stopSessionInput, stopSessionOutput, {
      invalidates: ["playbackSessions@v1"],
    }),
  },
});
