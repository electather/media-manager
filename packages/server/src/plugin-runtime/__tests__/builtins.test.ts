import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "../loader";
import type { PluginManifest } from "../types";
import traktPlugin from "../../plugins/builtin/trakt/plugin";
import tmdbPlugin from "../../plugins/builtin/tmdb/plugin";
import tvdbPlugin from "../../plugins/builtin/tvdb/plugin";
import seerrPlugin from "../../plugins/builtin/seerr/plugin";

const tmdbManifest: PluginManifest = tmdbPlugin.manifest;

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
  it("seerr", async () => {
    await expect(
      validatePluginModule(seerrPlugin, `builtin:${seerrPlugin.manifest.id}`),
    ).resolves.toBeDefined();
  });
});

describe("trakt manifest", () => {
  it("declares all expected capabilities", () => {
    const caps = Object.keys(traktPlugin.manifest.capabilities).sort();
    expect(caps).toEqual(
      [
        "calendar",
        "idResolve",
        "ratings",
        "recommendations",
        "userComments",
        "watchHistory",
        "watchlist",
      ].sort(),
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
  it("marks itself non-poolable", () => {
    expect(traktPlugin.manifest.poolable).toBe(false);
  });
});

describe("tmdb manifest", () => {
  it("is a pure-global, poolable plugin driven by shared credentials", () => {
    expect(tmdbManifest.auth.kind).toBe("none");
    expect(tmdbManifest.poolable).toBe(true);
    expect(tmdbManifest.sharedCredentialsSchema).toBeDefined();
    expect(tmdbManifest.credentialsSchema).toBeUndefined();
    expect(tmdbManifest.userConfigSchema).toBeUndefined();
  });
  it("scopes every capability as global", () => {
    for (const cap of Object.values(tmdbManifest.capabilities)) {
      expect(cap.scope).toBe("global");
    }
  });
});

describe("tvdb manifest", () => {
  it("is a pure-global, poolable plugin", () => {
    expect(tvdbPlugin.manifest.auth.kind).toBe("none");
    expect(tvdbPlugin.manifest.poolable).toBe(true);
    expect(tvdbPlugin.manifest.sharedCredentialsSchema).toBeDefined();
  });
});

describe("seerr manifest", () => {
  it("exposes mediaRequest as a user-scoped capability", () => {
    expect(seerrPlugin.manifest.capabilities.mediaRequest?.scope).toBe("user");
  });
});
