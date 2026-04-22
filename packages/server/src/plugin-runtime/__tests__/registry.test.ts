import { describe, it, expect, beforeEach } from "vite-plus/test";
import { CapabilityRegistry } from "../registry";
import type { CapabilityScope, ManifestCapability, PluginModule } from "../types";

function cap(version: string, scope: CapabilityScope = "user"): ManifestCapability {
  return { version, scope };
}

function fakePlugin(
  id: string,
  capabilities: Record<string, ManifestCapability>,
  options: { kind?: "none" | "form" } = {},
): PluginModule {
  const kind = options.kind ?? "form";
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      description: "",
      author: { name: "test" },
      sdkVersion: "^1.0.0",
      allowedHosts: [],
      credentialsSchema: kind === "none" ? undefined : { type: "object" },
      auth: { kind },
      capabilities,
    },
    capabilities: {},
  };
}

describe("CapabilityRegistry", () => {
  let reg: CapabilityRegistry;
  beforeEach(() => {
    reg = new CapabilityRegistry();
  });

  it("indexes providers by (capability, version, scope)", () => {
    reg.register({
      pluginId: "tmdb",
      module: fakePlugin("tmdb", { metadata: cap("v1", "global") }, { kind: "none" }),
      enabled: true,
    });
    expect(reg.listProviders("metadata", "v1", "global")).toEqual(["tmdb"]);
    expect(reg.listProviders("metadata", "v1", "user")).toEqual([]);
    expect(reg.listProviders("metadata", "v2", "global")).toEqual([]);
  });

  it("omits disabled plugins from listProviders", () => {
    reg.register({
      pluginId: "trakt",
      module: fakePlugin("trakt", { watchHistory: cap("v1", "user") }),
      enabled: false,
    });
    expect(reg.listProviders("watchHistory", "v1", "user")).toEqual([]);
  });

  it("re-adds providers when re-enabled", () => {
    reg.register({
      pluginId: "trakt",
      module: fakePlugin("trakt", { watchHistory: cap("v1", "user") }),
      enabled: false,
    });
    reg.setEnabled("trakt", true);
    expect(reg.listProviders("watchHistory", "v1", "user")).toEqual(["trakt"]);
    reg.setEnabled("trakt", false);
    expect(reg.listProviders("watchHistory", "v1", "user")).toEqual([]);
  });

  it("removes providers on unregister", () => {
    reg.register({
      pluginId: "tmdb",
      module: fakePlugin("tmdb", { metadata: cap("v1", "global") }, { kind: "none" }),
      enabled: true,
    });
    reg.unregister("tmdb");
    expect(reg.listProviders("metadata", "v1", "global")).toEqual([]);
    expect(reg.get("tmdb")).toBeUndefined();
  });

  it("separates global and user providers on the same capability id", () => {
    reg.register({
      pluginId: "tmdb",
      module: fakePlugin("tmdb", { metadata: cap("v1", "global") }, { kind: "none" }),
      enabled: true,
    });
    reg.register({
      pluginId: "personal-library",
      module: fakePlugin("personal-library", { metadata: cap("v1", "user") }),
      enabled: true,
    });
    expect(reg.listProviders("metadata", "v1", "global")).toEqual(["tmdb"]);
    expect(reg.listProviders("metadata", "v1", "user")).toEqual(["personal-library"]);
  });
});
