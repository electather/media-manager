import { describe, it, expect } from "vite-plus/test";
import { IdResolveV1 } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeCtx } from "./helpers";
import tmdbPlugin from "../src/plugin";

describe("idResolve capability contract", () => {
  it("short-circuits when source is already tmdb", async () => {
    const ctx = makeCtx([]);
    const out = await tmdbPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "tmdb",
      id: "550",
      type: "movie",
    });
    expect(ctx.calls.length).toBe(0);
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });

  it("hits /find/{id} with external_source=imdb_id", async () => {
    const ctx = makeCtx([
      jsonRes({
        movie_results: [{ id: 550 }],
        tv_results: [],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.idResolve!.resolve!(ctx, {
      from: "imdb",
      id: "tt0137523",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/find/tt0137523");
    expect(ctx.calls[0]?.url).toContain("external_source=imdb_id");
    expect(IdResolveV1.methods.resolve.output.safeParse(out).success).toBe(true);
  });
});
