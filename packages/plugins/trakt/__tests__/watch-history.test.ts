import { describe, it, expect } from "vite-plus/test";
import { WatchHistoryV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx, paginatedPage, MOVIE } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.watchHistory!;

describe("watchHistory", () => {
  it("getHistory: paginates /sync/history", async () => {
    const ctx = makeCtx([
      paginatedPage([{ id: 1, watched_at: "2026-04-01", type: "movie", movie: MOVIE }]),
    ]);
    const out = await cap.getHistory!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/sync/history");
    expect(ctx.calls[0]?.url).toContain("page=1");
    expect(WatchHistoryV1.methods.getHistory.output.safeParse(out).success).toBe(true);
  });

  it("getHistory: appends start_at when since is provided", async () => {
    const ctx = makeCtx([paginatedPage([])]);
    await cap.getHistory!(ctx, { since: "2026-01-01T00:00:00Z" });
    expect(ctx.calls[0]?.url).toContain("/sync/history?start_at=");
    expect(ctx.calls[0]?.url).toContain("2026-01-01");
  });

  it("addToHistory: POST /sync/history with split movies/shows", async () => {
    const ctx = makeCtx([jsonRes({ added: { movies: 1, episodes: 0 } })]);
    const out = await cap.addToHistory!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    expect(ctx.calls[0]?.url).toContain("/sync/history");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    expect(WatchHistoryV1.methods.addToHistory.output.safeParse(out).success).toBe(true);
  });

  it("removeFromHistory: POST /sync/history/remove", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1 } })]);
    const out = await cap.removeFromHistory!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    expect(ctx.calls[0]?.url).toContain("/sync/history/remove");
    expect(WatchHistoryV1.methods.removeFromHistory.output.safeParse(out).success).toBe(true);
  });
});
