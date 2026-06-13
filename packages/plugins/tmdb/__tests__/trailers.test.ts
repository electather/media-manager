import { describe, it, expect } from "vite-plus/test";
import { TrailersV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx } from "./helpers";
import tmdbPlugin from "../src/plugin";

describe("trailers capability contract", () => {
  it("hits /{type}/{id}/videos and maps YouTube keys to URLs", async () => {
    const ctx = makeCtx([
      jsonRes({
        results: [
          { key: "abc123", site: "YouTube", type: "Trailer", official: true },
          { key: "xyz789", site: "Vimeo", type: "Teaser" },
        ],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.trailers!.getVideos!(ctx, {
      id: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550/videos");
    expect(TrailersV1.methods.getVideos.output.safeParse(out).success).toBe(true);
    const videos = out as Array<{ kind: string; url: string | null }>;
    expect(videos[0]?.url).toBe("https://www.youtube.com/watch?v=abc123");
    expect(videos[1]?.url).toBe("https://vimeo.com/xyz789");
  });
});
