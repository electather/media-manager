import { describe, it, expect, beforeEach } from "vite-plus/test";
import { CapabilityRegistry } from "../registry";
import type { PluginModule } from "../types";

function fakePlugin(id: string, capabilities: Record<string, string>): PluginModule {
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
      auth: { kind: "none" },
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

  it("lists providers for a registered capability", () => {
    reg.register({
      pluginId: "tmdb",
      module: fakePlugin("tmdb", { metadata: "v1" }),
      enabled: true,
    });
    expect(reg.listProviders("metadata", "v1")).toEqual(["tmdb"]);
    expect(reg.listProviders("metadata", "v2")).toEqual([]);
  });

  it("omits disabled plugins from listProviders", () => {
    reg.register({
      pluginId: "trakt",
      module: fakePlugin("trakt", { watchHistory: "v1" }),
      enabled: false,
    });
    expect(reg.listProviders("watchHistory", "v1")).toEqual([]);
  });

  it("re-adds providers when re-enabled", () => {
    reg.register({
      pluginId: "trakt",
      module: fakePlugin("trakt", { watchHistory: "v1" }),
      enabled: false,
    });
    reg.setEnabled("trakt", true);
    expect(reg.listProviders("watchHistory", "v1")).toEqual(["trakt"]);
    reg.setEnabled("trakt", false);
    expect(reg.listProviders("watchHistory", "v1")).toEqual([]);
  });

  it("removes providers on unregister", () => {
    reg.register({
      pluginId: "tmdb",
      module: fakePlugin("tmdb", { metadata: "v1" }),
      enabled: true,
    });
    reg.unregister("tmdb");
    expect(reg.listProviders("metadata", "v1")).toEqual([]);
    expect(reg.get("tmdb")).toBeUndefined();
  });

  it("handles multiple providers on the same capability", () => {
    reg.register({
      pluginId: "tmdb",
      module: fakePlugin("tmdb", { metadata: "v1" }),
      enabled: true,
    });
    reg.register({
      pluginId: "another",
      module: fakePlugin("another", { metadata: "v1" }),
      enabled: true,
    });
    expect(reg.listProviders("metadata", "v1").sort()).toEqual(["another", "tmdb"]);
  });
});
