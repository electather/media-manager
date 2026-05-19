import { describe, it, expect } from "vite-plus/test";
import type { PluginManifest } from "@ent-mcp/shared/plugins";
import { validatePluginModule } from "../internal/loader";
import traktPlugin from "@ent-mcp/plugin-trakt";
import tmdbPlugin from "@ent-mcp/plugin-tmdb";
import tvdbPlugin from "@ent-mcp/plugin-tvdb";
import seerrPlugin from "@ent-mcp/plugin-seerr";
import jellyfinPlugin from "@ent-mcp/plugin-jellyfin";
import plexPlugin from "@ent-mcp/plugin-plex";

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
  it("jellyfin", async () => {
    await expect(
      validatePluginModule(jellyfinPlugin, `builtin:${jellyfinPlugin.manifest.id}`),
    ).resolves.toBeDefined();
  });
  it("plex", async () => {
    await expect(
      validatePluginModule(plexPlugin, `builtin:${plexPlugin.manifest.id}`),
    ).resolves.toBeDefined();
  });
});

describe("trakt manifest", () => {
  it("declares all expected capabilities", () => {
    const caps = Object.keys(traktPlugin.manifest.capabilities).sort();
    expect(caps).toEqual(
      [
        "calendar",
        "collection",
        "idResolve",
        "playback",
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

describe("plex manifest", () => {
  it("uses oauth_device auth and is not poolable", () => {
    expect(plexPlugin.manifest.auth.kind).toBe("oauth_device");
    expect(plexPlugin.manifest.poolable).toBe(false);
  });

  it("declares only a plex.tv static allow-floor; per-connection URLs arrive via x-allowed-host", () => {
    expect(plexPlugin.manifest.allowedHosts).toEqual(["plex.tv"]);
    const props = (plexPlugin.manifest.userConfigSchema as { properties: Record<string, unknown> })
      .properties;
    const ext = props["externalServerUrl"] as Record<string, unknown>;
    const int = props["internalServerUrl"] as Record<string, unknown>;
    expect(ext["x-allowed-host"]).toBe(true);
    expect(int["x-allowed-host"]).toBe(true);
    expect(int["x-private"]).toBe(true);
  });

  it("declares every capability as user-scoped, including idResolve", () => {
    for (const [name, cap] of Object.entries(plexPlugin.manifest.capabilities)) {
      expect([name, cap.scope]).toEqual([name, "user"]);
    }
  });
});
