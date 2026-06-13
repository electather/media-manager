import { describe, it, expect } from "vite-plus/test";
import { RatingsV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx, SHOW } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.ratings!;

describe("ratings", () => {
  it("getRatings (tv): hits /sync/ratings/shows", async () => {
    const ctx = makeCtx([jsonRes([{ rated_at: "2026-04-01", rating: 8, show: SHOW }])]);
    const out = await cap.getRatings!(ctx, { type: "tv" });
    expect(ctx.calls[0]?.url).toContain("/sync/ratings/shows");
    expect(RatingsV1.methods.getRatings.output.safeParse(out).success).toBe(true);
  });

  it("setRating: POST /sync/ratings", async () => {
    const ctx = makeCtx([jsonRes({ added: { movies: 1 } })]);
    const out = await cap.setRating!(ctx, {
      item: { type: "movie", ids: { trakt_id: "1" } },
      rating: 9,
    });
    expect(ctx.calls[0]?.url).toContain("/sync/ratings");
    expect(RatingsV1.methods.setRating.output.safeParse(out).success).toBe(true);
  });

  it("removeRating: POST /sync/ratings/remove", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1 } })]);
    const out = await cap.removeRating!(ctx, { item: { type: "movie", ids: { trakt_id: "1" } } });
    expect(ctx.calls[0]?.url).toContain("/sync/ratings/remove");
    expect(RatingsV1.methods.removeRating.output.safeParse(out).success).toBe(true);
  });
});
