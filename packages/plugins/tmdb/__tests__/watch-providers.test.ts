import { describe, it, expect } from "vite-plus/test";
import { WatchProvidersV1 } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeCtx } from "./helpers";
import tmdbPlugin from "../src/plugin";

describe("watchProviders capability contract", () => {
  it("hits /{type}/{id}/watch/providers and maps region", async () => {
    const ctx = makeCtx([
      jsonRes({
        results: {
          US: {
            flatrate: [{ provider_name: "Netflix" }],
            rent: [{ provider_name: "Apple TV" }],
            buy: [],
          },
        },
      }),
    ]);
    const out = await tmdbPlugin.capabilities.watchProviders!.getProviders!(ctx, {
      id: "550",
      type: "movie",
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550/watch/providers");
    expect(WatchProvidersV1.methods.getProviders.output.safeParse(out).success).toBe(true);
  });
});
