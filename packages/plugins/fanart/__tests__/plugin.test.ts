import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import fanartPlugin from "../src/plugin";

describe("fanart plugin", () => {
  it("passes loader validation", () => {
    expect(validatePluginModule(fanartPlugin)).toBeDefined();
  });

  it("declares the artwork@v1 capability with the documented manifest extras", () => {
    const cap = fanartPlugin.manifest.capabilities.artwork;
    expect(cap).toBeDefined();
    expect(cap?.version).toBe("v1");
    expect(cap?.scope).toBe("global");
    // The dispatcher's `aggregate_per_kind` strategy reads these to filter
    // ineligible providers and order the merge — regressions here silently
    // change merge behaviour, so lock them in.
    expect((cap as { supportedIdTypes: unknown }).supportedIdTypes).toEqual({
      movie: ["tmdb", "imdb"],
      tv: ["tvdb"],
    });
    expect((cap as { providerPriority: number }).providerPriority).toBe(10);
  });
});
