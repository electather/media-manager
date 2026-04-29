import { describe, it, expect } from "vite-plus/test";
import { IdResolveV1 } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeCtx, MOVIE } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.idResolve!;

describe("idResolve", () => {
  it("resolve: short-circuits when source is already trakt", async () => {
    const ctx = makeCtx([]);
    const out = await cap.resolve!(ctx, { from: "trakt", id: "1", type: "movie" });
    expect(ctx.calls.length).toBe(0);
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });

  it("resolve: hits /search/{idType}/{id}?type={kind}", async () => {
    const ctx = makeCtx([jsonRes([{ type: "movie", movie: MOVIE }])]);
    const out = await cap.resolve!(ctx, { from: "imdb", id: "tt0137523", type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/search/imdb/tt0137523");
    expect(ctx.calls[0]?.url).toContain("type=movie");
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });
});
