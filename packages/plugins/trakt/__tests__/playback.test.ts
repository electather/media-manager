import { describe, it, expect } from "vite-plus/test";
import { PlaybackV1 } from "@ent-mcp/plugin-sdk";
import { jsonRes, statusRes, makeCtx, MOVIE } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.playback!;

describe("playback", () => {
  it("getPositions: hits /sync/playback (no type filter)", async () => {
    const ctx = makeCtx([
      jsonRes([{ id: 1, progress: 50, paused_at: "2026-04-01", type: "movie", movie: MOVIE }]),
    ]);
    const out = await cap.getPositions!(ctx, {});
    expect(ctx.calls[0]?.url).toMatch(/\/sync\/playback$/);
    expect(PlaybackV1.methods.getPositions.output.safeParse(out).success).toBe(true);
  });

  it("getPositions (movie): hits /sync/playback/movies", async () => {
    const ctx = makeCtx([jsonRes([])]);
    await cap.getPositions!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/sync/playback/movies");
  });

  it("getPositions (tv): hits /sync/playback/episodes", async () => {
    const ctx = makeCtx([jsonRes([])]);
    await cap.getPositions!(ctx, { type: "tv" });
    expect(ctx.calls[0]?.url).toContain("/sync/playback/episodes");
  });

  it("removePosition: DELETE /sync/playback/{id}", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = await cap.removePosition!(ctx, { playbackId: "42" });
    expect(ctx.calls[0]?.url).toContain("/sync/playback/42");
    expect(ctx.calls[0]?.init?.method).toBe("DELETE");
    expect(PlaybackV1.methods.removePosition.output.safeParse(out).success).toBe(true);
  });
});
