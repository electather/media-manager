import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "../loader";
import { PluginError } from "../types";
import type { PluginModule } from "../types";

function minimalManifest(
  overrides: Partial<PluginModule["manifest"]> = {},
): PluginModule["manifest"] {
  return {
    id: "test",
    name: "Test",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    sdkVersion: "^1.0.0",
    allowedHosts: [],
    credentialsSchema: { type: "object" },
    auth: { kind: "none" },
    capabilities: {},
    ...overrides,
  };
}

describe("validatePluginModule", () => {
  it("accepts a minimal valid plugin", () => {
    const mod: PluginModule = { manifest: minimalManifest(), capabilities: {} };
    const loaded = validatePluginModule(mod, "source");
    expect(loaded.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects manifest with invalid id", () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ id: "BAD_ID" }),
      capabilities: {},
    };
    expect(() => validatePluginModule(mod, "source")).toThrow(PluginError);
  });

  it("rejects plugins that declare unknown capabilities", () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ capabilities: { notARealCapability: "v1" } }),
      capabilities: { notARealCapability: { foo: async () => null } },
    };
    expect(() => validatePluginModule(mod, "source")).toThrow(/unknown capability/);
  });

  it("rejects plugins that claim a capability but miss a method", () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ capabilities: { metadata: "v1" } }),
      capabilities: {
        metadata: {
          // only implements search — missing getDetails, getSimilar, etc.
          search: async () => [],
        },
      },
    };
    expect(() => validatePluginModule(mod, "source")).toThrow(/not implemented/);
  });

  it("requires testConnection when auth.kind != none", () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ auth: { kind: "form" } }),
      capabilities: {},
    };
    expect(() => validatePluginModule(mod, "source")).toThrow(/testConnection/);
  });

  it("requires a job handler when manifest.jobs declares one", () => {
    const mod: PluginModule = {
      manifest: minimalManifest({
        jobs: [{ id: "refresh", schedule: "*/5 * * * *", handler: "doRefresh" }],
      }),
      capabilities: {},
      jobs: {},
    };
    expect(() => validatePluginModule(mod, "source")).toThrow(/handler/);
  });
});
