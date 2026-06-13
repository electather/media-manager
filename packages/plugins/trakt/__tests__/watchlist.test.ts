import { describe, it, expect } from "vite-plus/test";
import { WatchlistV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx, MOVIE } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.watchlist!;

describe("watchlist", () => {
  it("getWatchlist (movie): hits /sync/watchlist/movies", async () => {
    const ctx = makeCtx([jsonRes([{ listed_at: "2026-04-01", type: "movie", movie: MOVIE }])]);
    const out = await cap.getWatchlist!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/sync/watchlist/movies");
    expect(WatchlistV1.methods.getWatchlist.output.safeParse(out).success).toBe(true);
  });

  it("addToWatchlist: POST /sync/watchlist", async () => {
    const ctx = makeCtx([jsonRes({ added: { movies: 1 } })]);
    const out = await cap.addToWatchlist!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    expect(ctx.calls[0]?.url).toContain("/sync/watchlist");
    expect(WatchlistV1.methods.addToWatchlist.output.safeParse(out).success).toBe(true);
  });

  it("removeFromWatchlist: POST /sync/watchlist/remove", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1 } })]);
    const out = await cap.removeFromWatchlist!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    expect(ctx.calls[0]?.url).toContain("/sync/watchlist/remove");
    expect(WatchlistV1.methods.removeFromWatchlist.output.safeParse(out).success).toBe(true);
  });
});
