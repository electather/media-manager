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
  it("trakt", async () => {
    await expect(
      validatePluginModule(traktPlugin, `builtin:${traktPlugin.manifest.id}`),
    ).resolves.toBeDefined();
  });
  it("tmdb", async () => {
    await expect(
      validatePluginModule(tmdbPlugin, `builtin:${tmdbPlugin.manifest.id}`),
    ).resolves.toBeDefined();
  });
  it("tvdb", async () => {
    await expect(
      validatePluginModule(tvdbPlugin, `builtin:${tvdbPlugin.manifest.id}`),
    ).resolves.toBeDefined();
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
  it("uses form auth and allows shared credentials", () => {
    expect(tvdbPlugin.manifest.auth.kind).toBe("form");
    expect(tvdbPlugin.manifest.allowsSharedCredentials).toBe(true);
  });
});
