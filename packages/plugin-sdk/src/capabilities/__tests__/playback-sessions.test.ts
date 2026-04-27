import { describe, it, expect } from "vite-plus/test";
import { PlaybackSessionsV1 } from "../playback-sessions";
import { getCapability } from "../index";

const libraryItemFixture = {
  id: "plex:12345",
  title: "Example Movie",
  type: "movie" as const,
  playerLink: "plex://server/12345",
  addedAt: "2026-04-20T10:00:00.000Z",
};

const sessionFixture = {
  sessionId: "s-1",
  deviceName: "Living Room Apple TV",
  user: { id: "u-42", name: "Alice" },
  item: libraryItemFixture,
  progressMs: 120_000,
  durationMs: 5_400_000,
  state: "playing" as const,
  startedAt: "2026-04-23T09:00:00.000Z",
};

describe("PlaybackSessionsV1", () => {
  it("registers as a user-scoped aggregate capability at v1", () => {
    expect(PlaybackSessionsV1.version).toBe("v1");
    expect(PlaybackSessionsV1.scope).toBe("user");
    expect(getCapability("playbackSessions", "v1")).toBe(PlaybackSessionsV1);
  });

  it("exposes getSessions and stopSession", () => {
    expect(Object.keys(PlaybackSessionsV1.methods).sort()).toEqual(
      ["getSessions", "stopSession"].sort(),
    );
  });

  describe("getSessions output", () => {
    it("accepts an empty array", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([]);
      expect(r.success).toBe(true);
    });

    it("accepts a minimal session entry", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([sessionFixture]);
      expect(r.success).toBe(true);
    });

    it("accepts transcoding details", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([
        {
          ...sessionFixture,
          state: "buffering",
          transcoding: {
            videoDecision: "transcode",
            audioDecision: "copy",
            targetBitrate: 12_000,
            reason: "Client does not support HEVC",
          },
        },
      ]);
      expect(r.success).toBe(true);
    });

    it("rejects an unknown state", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([
        { ...sessionFixture, state: "stopped" },
      ]);
      expect(r.success).toBe(false);
    });

    it("rejects a session without user id", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([
        { ...sessionFixture, user: { name: "Alice" } },
      ]);
      expect(r.success).toBe(false);
    });

    it("rejects unknown transcoding decisions", () => {
      const r = PlaybackSessionsV1.methods.getSessions.output.safeParse([
        { ...sessionFixture, transcoding: { videoDecision: "reencode", audioDecision: "copy" } },
      ]);
      expect(r.success).toBe(false);
    });
  });

  describe("stopSession", () => {
    it("accepts a sessionId alone", () => {
      const r = PlaybackSessionsV1.methods.stopSession.input.safeParse({ sessionId: "s-1" });
      expect(r.success).toBe(true);
    });

    it("accepts an optional reason", () => {
      const r = PlaybackSessionsV1.methods.stopSession.input.safeParse({
        sessionId: "s-1",
        reason: "Exceeded stream quota",
      });
      expect(r.success).toBe(true);
    });

    it("rejects an empty sessionId", () => {
      const r = PlaybackSessionsV1.methods.stopSession.input.safeParse({ sessionId: "" });
      expect(r.success).toBe(false);
    });

    it("returns forced or requested semantics", () => {
      const forced = PlaybackSessionsV1.methods.stopSession.output.safeParse({
        ok: true,
        semantics: "forced",
      });
      const requested = PlaybackSessionsV1.methods.stopSession.output.safeParse({
        ok: true,
        semantics: "requested",
      });
      expect(forced.success).toBe(true);
      expect(requested.success).toBe(true);
    });

    it("rejects unknown semantics", () => {
      const r = PlaybackSessionsV1.methods.stopSession.output.safeParse({
        ok: true,
        semantics: "maybe",
      });
      expect(r.success).toBe(false);
    });

    it("invalidates playbackSessions@v1 after stopping", () => {
      expect(PlaybackSessionsV1.methods.stopSession.invalidates).toEqual(["playbackSessions@v1"]);
    });
  });
});
