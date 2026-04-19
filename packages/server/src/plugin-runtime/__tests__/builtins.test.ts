import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "../loader";
import traktPlugin from "../../plugins/builtin/trakt/plugin";
import tmdbPlugin from "../../plugins/builtin/tmdb/plugin";
import tvdbPlugin from "../../plugins/builtin/tvdb/plugin";

/**
 * Contract tests: every built-in plugin must pass the full loader validation pipeline.
 * This catches missing capability methods, malformed manifests, and sdk mismatches before
 * the server boots.
 */
describe("built-in plugins pass loader validation", () => {
  it("trakt", () => {
    expect(() =>
      validatePluginModule(traktPlugin, `builtin:${traktPlugin.manifest.id}`),
    ).not.toThrow();
  });
  it("tmdb", () => {
    expect(() =>
      validatePluginModule(tmdbPlugin, `builtin:${tmdbPlugin.manifest.id}`),
    ).not.toThrow();
  });
  it("tvdb", () => {
    expect(() =>
      validatePluginModule(tvdbPlugin, `builtin:${tvdbPlugin.manifest.id}`),
    ).not.toThrow();
  });
});

describe("trakt manifest", () => {
  it("declares all expected capabilities", () => {
    const caps = Object.keys(traktPlugin.manifest.capabilities).sort();
    expect(caps).toEqual(
      ["calendar", "idResolve", "ratings", "recommendations", "watchHistory", "watchlist"].sort(),
    );
  });
  it("declares the refresh-tokens per-connection job", () => {
    const job = traktPlugin.manifest.jobs?.find((j) => j.id === "refresh-tokens");
    expect(job).toBeDefined();
    expect(job?.perConnection).toBe(true);
  });
  it("uses oauth_device auth", () => {
    expect(traktPlugin.manifest.auth.kind).toBe("oauth_device");
  });
});

describe("tmdb manifest", () => {
  it("uses form auth and accepts a shared global key", () => {
    expect(tmdbPlugin.manifest.auth.kind).toBe("form");
    expect(tmdbPlugin.manifest.globalConfigSchema).toBeDefined();
  });
});

describe("tvdb manifest", () => {
  it("uses form auth and accepts a shared global key", () => {
    expect(tvdbPlugin.manifest.auth.kind).toBe("form");
    expect(tvdbPlugin.manifest.globalConfigSchema).toBeDefined();
  });
});
