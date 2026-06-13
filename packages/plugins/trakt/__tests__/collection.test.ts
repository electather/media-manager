import { describe, it, expect } from "vite-plus/test";
import { CollectionV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx, MOVIE, SHOW } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.collection!;

describe("collection", () => {
  it("getCollection (movie): hits /sync/collection/movies", async () => {
    const ctx = makeCtx([jsonRes([{ collected_at: "2026-04-01", movie: MOVIE }])]);
    const out = await cap.getCollection!(ctx, { type: "movie" });
    expect(ctx.calls[0]?.url).toContain("/sync/collection/movies");
    expect(CollectionV1.methods.getCollection.output.safeParse(out).success).toBe(true);
  });

  it("getCollection (no type): fetches both and merges", async () => {
    const ctx = makeCtx([
      jsonRes([{ collected_at: "2026-04-01", movie: MOVIE }]),
      jsonRes([{ last_collected_at: "2026-04-02", show: SHOW }]),
    ]);
    const out = await cap.getCollection!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/sync/collection/movies");
    expect(ctx.calls[1]?.url).toContain("/sync/collection/shows");
    expect(CollectionV1.methods.getCollection.output.safeParse(out).success).toBe(true);
  });

  it("addToCollection: POST /sync/collection", async () => {
    const ctx = makeCtx([jsonRes({ added: { movies: 1 } })]);
    const out = await cap.addToCollection!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    expect(ctx.calls[0]?.url).toMatch(/\/sync\/collection$/);
    expect(CollectionV1.methods.addToCollection.output.safeParse(out).success).toBe(true);
  });

  it("removeFromCollection: POST /sync/collection/remove", async () => {
    const ctx = makeCtx([jsonRes({ deleted: { movies: 1 } })]);
    const out = await cap.removeFromCollection!(ctx, [{ type: "movie", ids: { trakt_id: "1" } }]);
    expect(ctx.calls[0]?.url).toContain("/sync/collection/remove");
    expect(CollectionV1.methods.removeFromCollection.output.safeParse(out).success).toBe(true);
  });
});
