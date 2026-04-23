import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import type { PluginModule } from "../types";

vi.mock("../../env", () => ({
  env: { ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" },
}));

// Simple in-memory plugin row store keyed by id.
const pluginRows = new Map<
  string,
  { id: string; globalConfig: string | null; manifest: string; personalKeyFallback: string }
>();

const dbMock = {
  select() {
    return {
      from(_table: unknown) {
        return {
          where(_: unknown) {
            return {
              async get() {
                // Runtime queries plugins by id via eq() — return any row (test sets up one at a time).
                return [...pluginRows.values()][0];
              },
            };
          },
        };
      },
    };
  },
  update(_table: unknown) {
    return {
      set(_: unknown) {
        return {
          where(_w: unknown) {
            return Promise.resolve();
          },
        };
      },
    };
  },
};

vi.mock("../../db/client", () => ({ getDb: () => dbMock }));

const listDecryptedActiveMock = vi.fn();
const markExhaustedMock = vi.fn();
const countEnabledMock = vi.fn();

vi.mock("../shared-credentials", () => ({
  sharedCredentialsService: {
    listDecryptedActive: (...args: unknown[]) => listDecryptedActiveMock(...args),
    markExhausted: (...args: unknown[]) => markExhaustedMock(...args),
    countEnabled: (...args: unknown[]) => countEnabledMock(...args),
    list: async () => [],
    add: async () => "",
    update: async () => {},
    delete: async () => {},
    getDecrypted: async () => ({ id: "", label: "", value: null }),
  },
}));

const listReadyUserConnectionsMock = vi.fn();
const markUserConnectionExhaustedMock = vi.fn();

vi.mock("../user-pool", () => ({
  listReadyUserConnections: (...args: unknown[]) => listReadyUserConnectionsMock(...args),
  markUserConnectionExhausted: (...args: unknown[]) => markUserConnectionExhaustedMock(...args),
}));

vi.mock("../../errors/capture", () => ({
  captureError: async () => {},
}));

vi.mock("../host-bridge", () => ({
  buildStore: () => ({
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  }),
  sweepExpiredStore: async () => 0,
}));

vi.mock("../fetch-policy", () => ({
  buildFetch: () => async () => new Response(""),
  buildLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

// Load after mocks so module bindings pick them up.
const { pluginRuntime } = await import("../runtime");
const { capabilityRegistry } = await import("../registry");

function buildPluginModule(
  onCall: (args: { ctx: unknown; input: unknown }) => Promise<unknown>,
): PluginModule {
  return {
    manifest: {
      id: "tmdb",
      name: "tmdb",
      version: "1.0.0",
      description: "",
      author: { name: "t" },
      sdkVersion: "^1.0.0",
      allowedHosts: [],
      sharedCredentialsSchema: { type: "object" },
      auth: { kind: "none" },
      capabilities: { idResolve: { version: "v1", scope: "global" } },
      poolable: true,
    },
    capabilities: {
      idResolve: {
        resolve: async (ctx, input) => onCall({ ctx, input }),
      },
    },
  };
}

beforeEach(() => {
  pluginRows.clear();
  capabilityRegistry.clear();
  listDecryptedActiveMock.mockReset();
  markExhaustedMock.mockReset();
  listReadyUserConnectionsMock.mockReset();
  markUserConnectionExhaustedMock.mockReset();
  listReadyUserConnectionsMock.mockResolvedValue([]);
});

function buildUserScopedModule(
  onCall: (args: { ctx: unknown; input: unknown }) => Promise<unknown>,
): PluginModule {
  return {
    manifest: {
      id: "trakt",
      name: "trakt",
      version: "1.0.0",
      description: "",
      author: { name: "t" },
      sdkVersion: "^1.0.0",
      allowedHosts: [],
      sharedCredentialsSchema: { type: "object" },
      credentialsSchema: { type: "object" },
      auth: { kind: "oauth_device" },
      capabilities: { watchHistory: { version: "v1", scope: "user" } },
      poolable: false,
    },
    capabilities: {
      watchHistory: {
        getHistory: async (ctx, input) => onCall({ ctx, input }),
        addToHistory: async (ctx, input) => onCall({ ctx, input }),
      },
    },
    testConnection: async () => ({ ok: true }),
  };
}

describe("pluginRuntime.invoke — scope + pool", () => {
  it("returns CAPABILITY_UNAVAILABLE when no admin pool entries exist for a global call", async () => {
    pluginRows.set("tmdb", {
      id: "tmdb",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    capabilityRegistry.register({
      pluginId: "tmdb",
      module: buildPluginModule(async () => ({})),
      enabled: true,
    });
    listDecryptedActiveMock.mockResolvedValue([]);

    await expect(
      pluginRuntime.invoke({
        pluginId: "tmdb",
        capability: "idResolve",
        version: "v1",
        method: "resolve",
        input: { from: "tmdb", id: "1", type: "movie" },
        scope: "global",
        userId: null,
      }),
    ).rejects.toMatchObject({ code: "plugin.capability_unavailable" });
  });

  it("rotates across admin pool entries on pool.markExhausted, eventually succeeding", async () => {
    pluginRows.set("tmdb", {
      id: "tmdb",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred1", label: "a", value: { apiKey: "key1" } },
      { id: "cred2", label: "b", value: { apiKey: "key2" } },
    ]);

    const calls: Array<{ apiKey: string }> = [];
    capabilityRegistry.register({
      pluginId: "tmdb",
      module: buildPluginModule(async ({ ctx }) => {
        const c = ctx as {
          sharedCredentials: { apiKey: string };
          pool: { markExhausted: (o?: { retryAfterSec?: number }) => void };
        };
        calls.push({ apiKey: c.sharedCredentials.apiKey });
        if (c.sharedCredentials.apiKey === "key1") {
          c.pool.markExhausted({ retryAfterSec: 42 });
          throw Object.assign(new Error("rate"), {
            name: "PluginError",
            code: "plugin.rate_limited",
          });
        }
        return { tmdb: "1" };
      }),
      enabled: true,
    });

    const result = await pluginRuntime.invoke<{ tmdb: string }>({
      pluginId: "tmdb",
      capability: "idResolve",
      version: "v1",
      method: "resolve",
      input: { from: "tmdb", id: "1", type: "movie" },
      scope: "global",
      userId: null,
    });
    expect(result).toEqual({ tmdb: "1" });
    expect(calls.map((c) => c.apiKey)).toEqual(["key1", "key2"]);
    expect(markExhaustedMock).toHaveBeenCalledWith({
      pluginId: "tmdb",
      credentialId: "cred1",
      retryAfterSec: 42,
    });
  });

  it("injects sharedCredentials on user-scoped calls even when personalKeyFallback is off", async () => {
    pluginRows.set("trakt", {
      id: "trakt",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred-admin", label: "app", value: { clientId: "cid", clientSecret: "cs" } },
    ]);
    listReadyUserConnectionsMock.mockResolvedValue([
      {
        connectionId: "conn-user",
        isDefault: true,
        credentials: { accessToken: "tok" },
        userConfig: null,
      },
    ]);

    let observed: { shared: unknown; creds: unknown } | null = null;
    capabilityRegistry.register({
      pluginId: "trakt",
      module: buildUserScopedModule(async ({ ctx }) => {
        const c = ctx as { credentials: unknown; sharedCredentials: unknown };
        observed = { shared: c.sharedCredentials, creds: c.credentials };
        return [];
      }),
      enabled: true,
    });

    await pluginRuntime.invoke({
      pluginId: "trakt",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
      scope: "user",
      userId: "user-1",
    });
    expect(observed).toEqual({
      shared: { clientId: "cid", clientSecret: "cs" },
      creds: { accessToken: "tok" },
    });
  });

  it("throws POOL_EXHAUSTED when every pool entry fails", async () => {
    pluginRows.set("tmdb", {
      id: "tmdb",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred1", label: "a", value: { apiKey: "key1" } },
    ]);
    capabilityRegistry.register({
      pluginId: "tmdb",
      module: buildPluginModule(async ({ ctx }) => {
        const c = ctx as { pool: { markExhausted: (o?: { retryAfterSec?: number }) => void } };
        c.pool.markExhausted({ retryAfterSec: 10 });
        throw Object.assign(new Error("rate"), {
          name: "PluginError",
          code: "plugin.rate_limited",
        });
      }),
      enabled: true,
    });

    await expect(
      pluginRuntime.invoke({
        pluginId: "tmdb",
        capability: "idResolve",
        version: "v1",
        method: "resolve",
        input: { from: "tmdb", id: "1", type: "movie" },
        scope: "global",
        userId: null,
      }),
    ).rejects.toMatchObject({ code: "plugin.pool_exhausted" });
  });

  it("tries admin picks before user picks when personalKeyFallback is admin-first", async () => {
    pluginRows.set("trakt", {
      id: "trakt",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "admin-first",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred-admin", label: "app", value: { clientId: "cid", clientSecret: "cs" } },
    ]);
    listReadyUserConnectionsMock.mockResolvedValue([
      {
        connectionId: "conn-user",
        isDefault: true,
        credentials: { accessToken: "tok" },
        userConfig: null,
      },
    ]);

    const order: Array<"admin" | "user"> = [];
    capabilityRegistry.register({
      pluginId: "trakt",
      module: buildUserScopedModule(async ({ ctx }) => {
        const c = ctx as { credentials: unknown };
        order.push(c.credentials === null ? "admin" : "user");
        return [];
      }),
      enabled: true,
    });

    await pluginRuntime.invoke({
      pluginId: "trakt",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
      scope: "user",
      userId: "user-1",
    });
    expect(order).toEqual(["admin"]);
  });

  it("tries user picks before admin picks when personalKeyFallback is personal-first", async () => {
    pluginRows.set("trakt", {
      id: "trakt",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "personal-first",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred-admin", label: "app", value: { clientId: "cid", clientSecret: "cs" } },
    ]);
    listReadyUserConnectionsMock.mockResolvedValue([
      {
        connectionId: "conn-user",
        isDefault: true,
        credentials: { accessToken: "tok" },
        userConfig: null,
      },
    ]);

    const order: Array<"admin" | "user"> = [];
    capabilityRegistry.register({
      pluginId: "trakt",
      module: buildUserScopedModule(async ({ ctx }) => {
        const c = ctx as {
          credentials: unknown;
          pool: { markExhausted: (o?: { retryAfterSec?: number }) => void };
        };
        order.push(c.credentials === null ? "admin" : "user");
        if (order.length === 1) {
          c.pool.markExhausted({ retryAfterSec: 5 });
          throw Object.assign(new Error("rate"), {
            name: "PluginError",
            code: "plugin.rate_limited",
          });
        }
        return [];
      }),
      enabled: true,
    });

    await pluginRuntime.invoke({
      pluginId: "trakt",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
      scope: "user",
      userId: "user-1",
    });
    expect(order).toEqual(["user", "admin"]);
    expect(markUserConnectionExhaustedMock).toHaveBeenCalledWith("conn-user", 5);
    expect(markExhaustedMock).not.toHaveBeenCalled();
  });

  it("rotates across user connections on markExhausted", async () => {
    pluginRows.set("trakt", {
      id: "trakt",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred-admin", label: "app", value: { clientId: "cid", clientSecret: "cs" } },
    ]);
    listReadyUserConnectionsMock.mockResolvedValue([
      {
        connectionId: "conn-a",
        isDefault: true,
        credentials: { accessToken: "tok-a" },
        userConfig: null,
      },
      {
        connectionId: "conn-b",
        isDefault: false,
        credentials: { accessToken: "tok-b" },
        userConfig: null,
      },
    ]);

    const seen: string[] = [];
    capabilityRegistry.register({
      pluginId: "trakt",
      module: buildUserScopedModule(async ({ ctx }) => {
        const c = ctx as {
          credentials: { accessToken: string };
          pool: { markExhausted: (o?: { retryAfterSec?: number }) => void };
        };
        seen.push(c.credentials.accessToken);
        if (c.credentials.accessToken === "tok-a") {
          c.pool.markExhausted({ retryAfterSec: 12 });
          throw Object.assign(new Error("rate"), {
            name: "PluginError",
            code: "plugin.rate_limited",
          });
        }
        return [];
      }),
      enabled: true,
    });

    await pluginRuntime.invoke({
      pluginId: "trakt",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
      scope: "user",
      userId: "user-1",
    });
    expect(seen).toEqual(["tok-a", "tok-b"]);
    expect(markUserConnectionExhaustedMock).toHaveBeenCalledWith("conn-a", 12);
    expect(markUserConnectionExhaustedMock).not.toHaveBeenCalledWith("conn-b", expect.anything());
  });

  it("does not inject an exhausted admin as sharedCredentials on later user picks", async () => {
    pluginRows.set("trakt", {
      id: "trakt",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "admin-first",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred-admin-1", label: "app1", value: { clientId: "c1", clientSecret: "s1" } },
      { id: "cred-admin-2", label: "app2", value: { clientId: "c2", clientSecret: "s2" } },
    ]);
    listReadyUserConnectionsMock.mockResolvedValue([
      {
        connectionId: "conn-user",
        isDefault: true,
        credentials: { accessToken: "tok" },
        userConfig: null,
      },
    ]);

    const observed: Array<{ side: "admin" | "user"; shared: { clientId: string } | null }> = [];
    capabilityRegistry.register({
      pluginId: "trakt",
      module: buildUserScopedModule(async ({ ctx }) => {
        const c = ctx as {
          credentials: { accessToken: string } | null;
          sharedCredentials: { clientId: string } | null;
          pool: { markExhausted: (o?: { retryAfterSec?: number }) => void };
        };
        const side = c.credentials === null ? "admin" : "user";
        observed.push({ side, shared: c.sharedCredentials });
        // Exhaust every admin so we fall through to the user pick.
        if (side === "admin") {
          c.pool.markExhausted({ retryAfterSec: 5 });
          throw Object.assign(new Error("rate"), {
            name: "PluginError",
            code: "plugin.rate_limited",
          });
        }
        return [];
      }),
      enabled: true,
    });

    await pluginRuntime.invoke({
      pluginId: "trakt",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
      scope: "user",
      userId: "user-1",
    });
    // The final (user) call must not see an admin credential that was just marked exhausted.
    const userCall = observed.find((o) => o.side === "user");
    expect(userCall?.shared).toBeNull();
  });
});

describe("pluginRuntime.invokeWithCredentials", () => {
  it("fails fast with plugin.input_invalid when input does not match the Zod schema", async () => {
    pluginRows.set("tmdb", {
      id: "tmdb",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listDecryptedActiveMock.mockResolvedValue([]);
    capabilityRegistry.register({
      pluginId: "tmdb",
      module: buildPluginModule(async () => {
        throw new Error("should not run");
      }),
      enabled: true,
    });

    await expect(
      pluginRuntime.invokeWithCredentials({
        pluginId: "tmdb",
        capability: "idResolve",
        version: "v1",
        method: "resolve",
        input: { from: "tmdb" },
        userId: null,
      }),
    ).rejects.toMatchObject({ code: "plugin.input_invalid" });
  });

  it("does not rotate — markExhausted signalling is ignored and no pool bookkeeping is touched", async () => {
    pluginRows.set("trakt", {
      id: "trakt",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred-admin", label: "app", value: { clientId: "cid", clientSecret: "cs" } },
    ]);

    let calls = 0;
    capabilityRegistry.register({
      pluginId: "trakt",
      module: buildUserScopedModule(async ({ ctx }) => {
        calls += 1;
        const c = ctx as { pool: { markExhausted: (o?: { retryAfterSec?: number }) => void } };
        c.pool.markExhausted({ retryAfterSec: 99 });
        return [];
      }),
      enabled: true,
    });

    await pluginRuntime.invokeWithCredentials({
      pluginId: "trakt",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
      userId: "user-1",
      credentials: { accessToken: "tok" },
    });
    expect(calls).toBe(1);
    expect(markExhaustedMock).not.toHaveBeenCalled();
    expect(markUserConnectionExhaustedMock).not.toHaveBeenCalled();
  });

  it("injects the first admin credential as ctx.sharedCredentials", async () => {
    pluginRows.set("trakt", {
      id: "trakt",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listDecryptedActiveMock.mockResolvedValue([
      { id: "cred-admin", label: "app", value: { clientId: "cid", clientSecret: "cs" } },
    ]);

    let observed: { shared: unknown; creds: unknown } | null = null;
    capabilityRegistry.register({
      pluginId: "trakt",
      module: buildUserScopedModule(async ({ ctx }) => {
        const c = ctx as { credentials: unknown; sharedCredentials: unknown };
        observed = { shared: c.sharedCredentials, creds: c.credentials };
        return [];
      }),
      enabled: true,
    });

    await pluginRuntime.invokeWithCredentials({
      pluginId: "trakt",
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
      userId: "user-1",
      credentials: { accessToken: "tok" },
    });
    expect(observed).toEqual({
      shared: { clientId: "cid", clientSecret: "cs" },
      creds: { accessToken: "tok" },
    });
  });
});
