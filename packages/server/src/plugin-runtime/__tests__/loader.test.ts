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
  it("accepts a minimal valid plugin", async () => {
    const mod: PluginModule = { manifest: minimalManifest(), capabilities: {} };
    const loaded = await validatePluginModule(mod, "source");
    expect(loaded.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects manifest with invalid id", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ id: "BAD_ID" }),
      capabilities: {},
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(PluginError);
  });

  it("rejects plugins that declare unknown capabilities", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ capabilities: { notARealCapability: "v1" } }),
      capabilities: { notARealCapability: { foo: async () => null } },
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/unknown capability/);
  });

  it("rejects plugins that claim a capability but miss a method", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ capabilities: { metadata: "v1" } }),
      capabilities: {
        metadata: {
          // Only implements search — missing getDetails, getSimilar, etc.
          search: async () => [],
        },
      },
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/not implemented/);
  });

  it("requires testConnection when auth.kind != none", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ auth: { kind: "form" } }),
      capabilities: {},
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/testConnection/);
  });

  it("requires a job handler when manifest.jobs declares one", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({
        jobs: [{ id: "refresh", schedule: "*/5 * * * *", handler: "doRefresh" }],
      }),
      capabilities: {},
      jobs: {},
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/handler/);
  });
});
