import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "@nama/plugin-sdk";
import tmdbPlugin from "../src/plugin";

describe("tmdb plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", async () => {
    expect(validatePluginModule(tmdbPlugin)).toBeDefined();
  });
});
