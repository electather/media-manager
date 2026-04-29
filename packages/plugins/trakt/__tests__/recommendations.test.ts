import { describe, it, expect } from "vite-plus/test";
import { RecommendationsV1 } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeCtx, MOVIE, SHOW } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.recommendations!;

describe("recommendations", () => {
  it("getRecommendations (movie): hits /recommendations/movies", async () => {
    const ctx = makeCtx([jsonRes([MOVIE])]);
    const out = await cap.getRecommendations!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/recommendations/movies");
    expect(RecommendationsV1.methods.getRecommendations.output.safeParse(out).success).toBe(true);
  });

  it("getTrending (tv): hits /shows/trending", async () => {
    const ctx = makeCtx([jsonRes([{ watchers: 10, show: SHOW }])]);
    const out = await cap.getTrending!(ctx, { type: "tv" });
    expect(ctx.calls[0]?.url).toContain("/shows/trending");
    expect(RecommendationsV1.methods.getTrending.output.safeParse(out).success).toBe(true);
  });

  it("getAnticipated (movie): hits /movies/anticipated", async () => {
    const ctx = makeCtx([jsonRes([{ list_count: 1, movie: MOVIE }])]);
    const out = await cap.getAnticipated!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/movies/anticipated");
    expect(RecommendationsV1.methods.getAnticipated.output.safeParse(out).success).toBe(true);
  });
});
