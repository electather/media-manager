import { describe, it, expect } from "vite-plus/test";
import type { ManifestCapability } from "@ent-mcp/shared/plugins";
import { pluginManifestSchema } from "@ent-mcp/shared/plugins";
import { capabilityKey, getCapability } from "@ent-mcp/plugin-sdk";
import { CapabilityRegistry } from "../registry";
import type { PluginModule } from "@ent-mcp/plugin-sdk";

describe("capability catalog helpers", () => {
  it("keys by id@version", () => {
    expect(capabilityKey("metadata", "v1")).toBe("metadata@v1");
  });

  it("returns undefined for unknown versions", () => {
    expect(getCapability("metadata", "v99")).toBeUndefined();
  });
});

describe("idResolve@v1 registry wiring", () => {
  function fakeUserScopedIdResolvePlugin(id: string): PluginModule {
    const capability: ManifestCapability = { version: "v1", scope: "user" };
    return {
      manifest: {
        id,
        name: id,
        version: "1.0.0",
        description: "",
        author: { name: "test" },
        sdkVersion: "^1.0.0",
        allowedHosts: [],
        credentialsSchema: { type: "object" },
        auth: { kind: "form" },
        capabilities: { idResolve: capability },
      },
      capabilities: {},
    };
  }

  it("registers and is resolvable via the registry when declared with scope: user", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      pluginId: "plex",
      module: fakeUserScopedIdResolvePlugin("plex"),
      enabled: true,
    });
    expect(reg.listProviders("idResolve", "v1", "user")).toEqual(["plex"]);
    expect(reg.listProviders("idResolve", "v1", "global")).toEqual([]);
  });

  it("fake plugin manifest passes the shared manifest schema", () => {
    const manifest = fakeUserScopedIdResolvePlugin("plex").manifest;
    const parsed = pluginManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
  });
});

describe("playbackSessions@v1 + libraryAdmin@v1 registry wiring", () => {
  function fakeUserScopedMediaServerPlugin(id: string): PluginModule {
    const playback: ManifestCapability = { version: "v1", scope: "user" };
    const admin: ManifestCapability = { version: "v1", scope: "user" };
    return {
      manifest: {
        id,
        name: id,
        version: "1.0.0",
        description: "",
        author: { name: "test" },
        sdkVersion: "^1.0.0",
        allowedHosts: [],
        credentialsSchema: { type: "object" },
        auth: { kind: "form" },
        capabilities: { playbackSessions: playback, libraryAdmin: admin },
      },
      capabilities: {},
    };
  }

  it("registers both capabilities under the user scope", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      pluginId: "plex",
      module: fakeUserScopedMediaServerPlugin("plex"),
      enabled: true,
    });
    expect(reg.listProviders("playbackSessions", "v1", "user")).toEqual(["plex"]);
    expect(reg.listProviders("libraryAdmin", "v1", "user")).toEqual(["plex"]);
    expect(reg.listProviders("playbackSessions", "v1", "global")).toEqual([]);
    expect(reg.listProviders("libraryAdmin", "v1", "global")).toEqual([]);
  });

  it("fake plugin manifest passes the shared manifest schema", () => {
    const manifest = fakeUserScopedMediaServerPlugin("plex").manifest;
    const parsed = pluginManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
  });
});
