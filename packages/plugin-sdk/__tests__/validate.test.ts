import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import type { PluginManifest } from "@ent-mcp/shared/plugins";
import type { PluginModule } from "../src/types";

// Mock isSdkCompatible so we can exercise the assertSdkCompatible gate
// directly. The real implementation currently rejects only empty/whitespace
// strings, which the manifest schema also rejects, so without the mock the
// gate is unreachable — and it is the gate we want to keep regression-tested
// as the SDK evolves.
const { mockIsSdkCompatible } = vi.hoisted(() => ({
  mockIsSdkCompatible: vi.fn<(range: string) => boolean>(),
}));
vi.mock("../src/version", () => ({
  SDK_VERSION: "0.1.0",
  isSdkCompatible: mockIsSdkCompatible,
}));

// validate.ts must be imported AFTER vi.mock has been registered.
const { validatePluginModule } = await import("../src/validate");

interface PluginErrorLike {
  name: string;
  code: string;
  message: string;
}

function expectPluginError(fn: () => unknown, code: string): PluginErrorLike {
  try {
    fn();
  } catch (err) {
    const e = err as PluginErrorLike;
    expect(e.name).toBe("PluginError");
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`expected validatePluginModule to throw with code ${code}`);
}

function makeGlobalManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "",
    author: { name: "tester" },
    sdkVersion: "^0.1.0",
    allowedHosts: [],
    auth: { kind: "none" },
    capabilities: {
      watchProviders: { version: "v1", scope: "global" },
    },
    ...overrides,
  } as PluginManifest;
}

function makeGlobalModule(overrides: Partial<PluginModule> = {}): PluginModule {
  return {
    manifest: makeGlobalManifest(),
    capabilities: {
      watchProviders: {
        getProviders: async () => ({}),
      },
    },
    ...overrides,
  };
}

function makeUserManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "",
    author: { name: "tester" },
    sdkVersion: "^0.1.0",
    allowedHosts: [],
    auth: { kind: "form" },
    credentialsSchema: { type: "object", properties: {} },
    capabilities: {
      watchlist: { version: "v1", scope: "user" },
    },
    ...overrides,
  } as PluginManifest;
}

function makeUserModule(overrides: Partial<PluginModule> = {}): PluginModule {
  return {
    manifest: makeUserManifest(),
    testConnection: async () => ({ ok: true }),
    capabilities: {
      watchlist: {
        getWatchlist: async () => [],
        addToWatchlist: async () => ({ added: 0 }),
        removeFromWatchlist: async () => ({ removed: 0 }),
      },
    },
    ...overrides,
  };
}

describe("validatePluginModule", () => {
  beforeEach(() => {
    mockIsSdkCompatible.mockReset();
    mockIsSdkCompatible.mockReturnValue(true);
  });

  it("returns the module and serialised manifest on the happy path", () => {
    const module = makeGlobalModule();
    const result = validatePluginModule(module);
    expect(result.module).toBe(module);
    const reparsed = JSON.parse(result.manifestJson) as { id: string };
    expect(reparsed.id).toBe("test-plugin");
  });

  it("rejects a manifest that fails schema parsing with plugin.input_invalid", () => {
    const module = makeGlobalModule({
      manifest: makeGlobalManifest({ id: "INVALID UPPERCASE" }),
    });
    expectPluginError(() => validatePluginModule(module), "plugin.input_invalid");
  });

  it("rejects an sdkVersion the host marks incompatible with plugin.input_invalid", () => {
    mockIsSdkCompatible.mockReturnValue(false);
    const module = makeGlobalModule({
      manifest: makeGlobalManifest({ sdkVersion: "^99.0.0" }),
    });
    const err = expectPluginError(() => validatePluginModule(module), "plugin.input_invalid");
    expect(err.message).toContain("^99.0.0");
  });

  it("rejects an unknown declared capability with plugin.missing_method", () => {
    const manifest = makeGlobalManifest({
      capabilities: {
        notARealCapability: { version: "v1", scope: "global" },
      },
    });
    const module = makeGlobalModule({
      manifest,
      capabilities: {
        notARealCapability: { someMethod: async () => null },
      },
    });
    const err = expectPluginError(() => validatePluginModule(module), "plugin.missing_method");
    expect(err.message).toContain("notARealCapability");
  });

  it("rejects a declared capability with no implementation with plugin.missing_method", () => {
    const module = makeGlobalModule({
      capabilities: {},
    });
    expectPluginError(() => validatePluginModule(module), "plugin.missing_method");
  });

  it("rejects a declared capability method that is not a function with plugin.missing_method", () => {
    const module = makeGlobalModule({
      capabilities: {
        watchProviders: {
          // Non-function in the slot — must be flagged as missing.
          getProviders: "not a function" as unknown as () => Promise<unknown>,
        },
      },
    });
    const err = expectPluginError(() => validatePluginModule(module), "plugin.missing_method");
    expect(err.message).toContain("getProviders");
  });

  it("rejects a job referencing a missing handler with plugin.missing_method", () => {
    const manifest = makeGlobalManifest({
      jobs: [{ id: "sync", schedule: "0 * * * *", handler: "syncHandler" }],
    });
    const module = makeGlobalModule({ manifest, jobs: {} });
    const err = expectPluginError(() => validatePluginModule(module), "plugin.missing_method");
    expect(err.message).toContain("syncHandler");
  });

  it("rejects a non-`none` auth without testConnection with plugin.missing_auth_fn", () => {
    const module = makeUserModule();
    delete module.testConnection;
    expectPluginError(() => validatePluginModule(module), "plugin.missing_auth_fn");
  });

  it("rejects an mcpTool whose name starts with `ext_` with plugin.input_invalid", () => {
    const manifest = makeGlobalManifest({
      mcpTools: [
        {
          name: "ext_already_prefixed",
          description: "bad",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          handler: "h",
        },
      ],
    });
    const module = makeGlobalModule({
      manifest,
      mcpTools: { h: async () => null },
    });
    expectPluginError(() => validatePluginModule(module), "plugin.input_invalid");
  });

  it("rejects duplicate mcpTool names with plugin.input_invalid", () => {
    const manifest = makeGlobalManifest({
      mcpTools: [
        {
          name: "dup_tool",
          description: "first",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          handler: "h",
        },
        {
          name: "dup_tool",
          description: "second",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          handler: "h",
        },
      ],
    });
    const module = makeGlobalModule({
      manifest,
      mcpTools: { h: async () => null },
    });
    const err = expectPluginError(() => validatePluginModule(module), "plugin.input_invalid");
    expect(err.message).toContain("dup_tool");
  });

  it("rejects a prefixed mcpTool name longer than 64 characters with plugin.input_invalid", () => {
    // `ext_test-plugin_` is 16 chars; pad past the 64-char ceiling.
    const longName = "a".repeat(50);
    const manifest = makeGlobalManifest({
      mcpTools: [
        {
          name: longName,
          description: "long",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          handler: "h",
        },
      ],
    });
    const module = makeGlobalModule({
      manifest,
      mcpTools: { h: async () => null },
    });
    const err = expectPluginError(() => validatePluginModule(module), "plugin.input_invalid");
    expect(err.message).toContain("64");
  });

  it("rejects an mcpTool referencing a missing handler with plugin.missing_method", () => {
    const manifest = makeGlobalManifest({
      mcpTools: [
        {
          name: "tool_one",
          description: "no handler",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          handler: "missingHandler",
        },
      ],
    });
    const module = makeGlobalModule({
      manifest,
      mcpTools: {},
    });
    const err = expectPluginError(() => validatePluginModule(module), "plugin.missing_method");
    expect(err.message).toContain("missingHandler");
  });
});
