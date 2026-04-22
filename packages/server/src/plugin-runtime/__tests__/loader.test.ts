import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "../loader";
import { PluginError } from "../types";
import type { ManifestCapability, PluginModule } from "../types";

function cap(version = "v1", scope: "global" | "user" = "global"): ManifestCapability {
  return { version, scope };
}

function minimalManifest(
  overrides: Partial<PluginModule["manifest"]> = {},
): PluginModule["manifest"] {
  const base: PluginModule["manifest"] = {
    id: "test",
    name: "Test",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    sdkVersion: "^1.0.0",
    allowedHosts: [],
    auth: { kind: "none" },
    // Default to a single global-scoped capability so the Zod derived rules
    // are satisfied without forcing every test to restate them.
    capabilities: { idResolve: cap("v1", "global") },
    sharedCredentialsSchema: { type: "object" },
  };
  return { ...base, ...overrides };
}

describe("validatePluginModule", () => {
  it("accepts a minimal valid plugin", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest(),
      capabilities: {
        idResolve: { resolve: async () => ({}) },
      },
    };
    const loaded = await validatePluginModule(mod, "source");
    expect(loaded.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects manifest with invalid id", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({ id: "BAD_ID" }),
      capabilities: { idResolve: { resolve: async () => ({}) } },
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(PluginError);
  });

  it("rejects plugins that declare unknown capabilities", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({
        capabilities: { notARealCapability: cap("v1", "global") },
      }),
      capabilities: { notARealCapability: { foo: async () => null } },
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/unknown capability/);
  });

  it("rejects plugins that claim a capability but miss a method", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({
        auth: { kind: "form" },
        credentialsSchema: { type: "object" },
        capabilities: { metadata: cap("v1", "user") },
      }),
      capabilities: {
        metadata: {
          // Only implements search — missing getDetails, getSimilar, etc.
          search: async () => [],
        },
      },
      testConnection: async () => ({ ok: true }),
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/not implemented/);
  });

  it("requires testConnection when auth.kind != none", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({
        auth: { kind: "form" },
        credentialsSchema: { type: "object" },
        capabilities: { watchHistory: cap("v1", "user") },
      }),
      capabilities: {
        watchHistory: {
          getHistory: async () => [],
          addToHistory: async () => ({ added: 0 }),
        },
      },
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/testConnection/);
  });

  it("requires a job handler when manifest.jobs declares one", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({
        jobs: [{ id: "refresh", schedule: "*/5 * * * *", handler: "doRefresh" }],
      }),
      capabilities: { idResolve: { resolve: async () => ({}) } },
      jobs: {},
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/handler/);
  });

  it("rejects a pure-global plugin that also declares credentialsSchema", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({
        credentialsSchema: { type: "object" },
      }),
      capabilities: { idResolve: { resolve: async () => ({}) } },
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/credentialsSchema/);
  });

  it("rejects a user-scoped plugin missing credentialsSchema", async () => {
    const mod: PluginModule = {
      manifest: minimalManifest({
        auth: { kind: "form" },
        capabilities: { watchlist: cap("v1", "user") },
      }),
      capabilities: {
        watchlist: {
          getWatchlist: async () => [],
          addToWatchlist: async () => ({ added: 0 }),
          removeFromWatchlist: async () => ({ removed: 0 }),
        },
      },
      testConnection: async () => ({ ok: true }),
    };
    await expect(validatePluginModule(mod, "source")).rejects.toThrow(/credentialsSchema/);
  });
});
