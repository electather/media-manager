import { describe, it, expect } from "vite-plus/test";
import type { ManifestCapability } from "@ent-mcp/shared/plugins";
import { pluginManifestSchema } from "@ent-mcp/shared/plugins";
import { capabilityKey, getCapability } from "@ent-mcp/plugin-sdk";
import { classifyScopes } from "../internal/manifest";
import { CapabilityRegistry } from "../internal/registry";
import type { PluginModule } from "@ent-mcp/plugin-sdk";

describe("capability catalog helpers", () => {
  it("keys by id@version", () => {
    expect(capabilityKey("metadata", "v1")).toBe("metadata@v1");
  });

  it("returns undefined for unknown versions", () => {
    expect(getCapability("metadata", "v99")).toBeUndefined();
  });
});

describe("classifyScopes", () => {
  type ClassifiableManifest = Parameters<typeof classifyScopes>[0];

  function makeClassifiableManifest(
    capabilities: ClassifiableManifest["capabilities"],
    options: {
      sharedCredentialsSchema?: Record<string, unknown>;
      authKind?: ClassifiableManifest["auth"]["kind"];
    } = {},
  ): ClassifiableManifest {
    const authKind = options.authKind ?? "form";
    return {
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "",
      author: { name: "Test" },
      sdkVersion: "^1.0.0",
      allowedHosts: [],
      auth: { kind: authKind },
      credentialsSchema: authKind === "none" ? undefined : { type: "object" },
      sharedCredentialsSchema: options.sharedCredentialsSchema,
      capabilities,
    };
  }

  it("marks personal-key fallback supported only for shared user-scoped plugins (V65)", () => {
    const sharedUserScoped = makeClassifiableManifest(
      {
        watchHistory: { version: "v1", scope: "user" },
      },
      { sharedCredentialsSchema: { type: "object" } },
    );
    const noSharedUserScoped = makeClassifiableManifest({
      watchHistory: { version: "v1", scope: "user" },
    });
    const mixedWithoutShared = makeClassifiableManifest({
      metadata: { version: "v1", scope: "global" },
      watchHistory: { version: "v1", scope: "user" },
    });
    const pureGlobal = makeClassifiableManifest(
      {
        metadata: { version: "v1", scope: "global" },
      },
      {
        authKind: "none",
        sharedCredentialsSchema: { type: "object" },
      },
    );

    expect(classifyScopes(sharedUserScoped)).toMatchObject({
      supportsPersonalKeyFallback: true,
    });
    expect(classifyScopes(noSharedUserScoped)).toMatchObject({
      supportsPersonalKeyFallback: false,
    });
    expect(classifyScopes(mixedWithoutShared)).toMatchObject({
      supportsPersonalKeyFallback: false,
    });
    expect(classifyScopes(pureGlobal)).toMatchObject({
      supportsPersonalKeyFallback: false,
    });
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
