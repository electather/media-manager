import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import type { PluginModule } from "@ent-mcp/plugin-sdk";

// E2E: verify x-allowed-host on a user-scoped plugin's userConfigSchema causes
// the hostname from the stored userConfig to be added to ctx.fetch's
// allowlist, alongside manifest.allowedHosts (unioned).

vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    // Stubbed so ctx.appBaseUrl is not undefined inside ctx construction —
    // the tests don't assert on it, but the mock now mirrors what runtime
    // sees at production time, which prevents a future regression where a
    // missing env var silently falls through.
    APP_EXTERNAL_URL: "https://app.example.com",
  },
}));

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

vi.mock("../shared-credentials", () => ({
  sharedCredentialsService: {
    listDecryptedActive: (...args: unknown[]) => listDecryptedActiveMock(...args),
    markExhausted: (...args: unknown[]) => markExhaustedMock(...args),
    countEnabled: async () => 0,
    list: async () => [],
    add: async () => "",
    update: async () => {},
    delete: async () => {},
    getDecrypted: async () => ({ id: "", label: "", value: null }),
  },
}));

const listReadyUserConnectionsMock = vi.fn();
vi.mock("../user-pool", () => ({
  listReadyUserConnections: (...args: unknown[]) => listReadyUserConnectionsMock(...args),
  markUserConnectionExhausted: vi.fn(),
}));

const captureErrorMock = vi.fn<typeof import("../../errors/capture").captureError>();
vi.mock("../../errors/capture", () => ({
  captureError: captureErrorMock,
}));

vi.mock("../host-bridge", () => ({
  buildStore: () => ({
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  }),
  sweepExpiredStore: async () => 0,
}));

// Intentionally do NOT mock ../fetch-policy here — we want the real buildFetch
// so we can assert that the dynamic host derived from userConfig flows through.

const { pluginRuntime } = await import("../runtime");
const { capabilityRegistry } = await import("../registry");

// A user-scoped plugin (like a self-hosted media server) whose base URL is
// supplied at connection time via userConfig. The schema marks `baseUrl` with
// x-allowed-host so the host appends its hostname to the ctx.fetch allowlist.
function buildSelfHostedPlugin(
  onCall: (args: { ctx: unknown; input: unknown }) => Promise<unknown>,
): PluginModule {
  return {
    manifest: {
      id: "plex-like",
      name: "Plex-like",
      version: "1.0.0",
      description: "",
      author: { name: "t" },
      sdkVersion: "^1.0.0",
      allowedHosts: [],
      userConfigSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", "x-allowed-host": true },
        },
      },
      credentialsSchema: { type: "object" },
      auth: { kind: "form" },
      capabilities: { library: { version: "v1", scope: "user" } },
      poolable: false,
    },
    capabilities: {
      library: {
        list: async (ctx, input) => onCall({ ctx, input }),
      },
    },
  };
}

// Register a synthetic capability spec so the runtime's requireMethodSpec
// check succeeds. We do this lazily by mocking the SDK module that exposes
// getCapability.
vi.mock("@ent-mcp/plugin-sdk", async (orig) => {
  const mod = (await orig()) as object;
  return {
    ...mod,
    getCapability: () => ({
      id: "library",
      version: "v1",
      strategy: { kind: "single" },
      scope: "user",
      defaultCacheTtlSec: 60,
      negativeCacheTtlSec: 30,
      defaultTimeoutMs: 5_000,
      methods: {
        list: {
          input: {
            safeParse: (v: unknown) => ({ success: true, data: v }),
          },
          output: {
            safeParse: (v: unknown) => ({ success: true, data: v }),
          },
        },
      },
    }),
  };
});

describe("runtime honors x-allowed-host from userConfigSchema", () => {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true })));

  beforeEach(() => {
    pluginRows.clear();
    capabilityRegistry.clear();
    listDecryptedActiveMock.mockReset();
    listReadyUserConnectionsMock.mockReset();
    listDecryptedActiveMock.mockResolvedValue([]);
    captureErrorMock.mockReset();
    fetchSpy.mockClear();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows ctx.fetch to reach the hostname declared in the connection's userConfig.baseUrl", async () => {
    pluginRows.set("plex-like", {
      id: "plex-like",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listReadyUserConnectionsMock.mockResolvedValue([
      {
        connectionId: "conn-1",
        isDefault: true,
        credentials: { token: "t" },
        userConfig: { baseUrl: "https://my.plex.box:32400" },
      },
    ]);

    let observedResponse: unknown;
    capabilityRegistry.register({
      pluginId: "plex-like",
      module: buildSelfHostedPlugin(async ({ ctx }) => {
        const c = ctx as {
          fetch: (url: string, init?: RequestInit) => Promise<Response>;
        };
        const res = await c.fetch("https://my.plex.box:32400/library/sections");
        observedResponse = await res.json();
        return { items: [] };
      }),
      enabled: true,
    });

    const result = await pluginRuntime.invoke<{ items: unknown[] }>({
      pluginId: "plex-like",
      capability: "library",
      version: "v1",
      method: "list",
      input: {},
      scope: "user",
      userId: "user-1",
    });
    expect(result).toEqual({ items: [] });
    expect(observedResponse).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith("https://my.plex.box:32400/library/sections", undefined);
  });

  it("rejects ctx.fetch to a hostname not in the static list nor derived from userConfig", async () => {
    pluginRows.set("plex-like", {
      id: "plex-like",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listReadyUserConnectionsMock.mockResolvedValue([
      {
        connectionId: "conn-1",
        isDefault: true,
        credentials: { token: "t" },
        userConfig: { baseUrl: "https://my.plex.box:32400" },
      },
    ]);

    const caught: Array<{ code?: string }> = [];
    capabilityRegistry.register({
      pluginId: "plex-like",
      module: buildSelfHostedPlugin(async ({ ctx }) => {
        const c = ctx as {
          fetch: (url: string, init?: RequestInit) => Promise<Response>;
        };
        try {
          await c.fetch("https://someone-else.example.com/leak");
        } catch (err) {
          caught.push(err as { code?: string });
        }
        return { items: [] };
      }),
      enabled: true,
    });

    await pluginRuntime.invoke({
      pluginId: "plex-like",
      capability: "library",
      version: "v1",
      method: "list",
      input: {},
      scope: "user",
      userId: "user-1",
    });
    expect(caught[0]?.code).toBe("plugin.upstream_error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // A global-scope plugin whose upstream is declared on the admin's shared
  // credentials. Mirrors plugins like a self-hosted registry mirror where the
  // operator sets the backing URL once. The runtime resolves x-allowed-host
  // against `sharedCredentialsSchema` (not `userConfigSchema`) for admin picks.
  it("resolves x-allowed-host from sharedCredentialsSchema for admin-scoped calls", async () => {
    pluginRows.set("ops-tool", {
      id: "ops-tool",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });
    listDecryptedActiveMock.mockResolvedValue([
      {
        id: "admin-cred-1",
        value: { baseUrl: "https://ops.internal.example.com", apiKey: "k" },
      },
    ]);

    let observedJson: unknown;
    capabilityRegistry.register({
      pluginId: "ops-tool",
      module: {
        manifest: {
          id: "ops-tool",
          name: "Ops",
          version: "1.0.0",
          description: "",
          author: { name: "t" },
          sdkVersion: "^1.0.0",
          allowedHosts: [],
          sharedCredentialsSchema: {
            type: "object",
            properties: {
              baseUrl: { type: "string", "x-allowed-host": true },
              apiKey: { type: "string", "x-secret": true },
            },
          },
          credentialsSchema: { type: "object" },
          auth: { kind: "form" },
          capabilities: { library: { version: "v1", scope: "global" } },
          poolable: true,
        },
        capabilities: {
          library: {
            list: async (ctx) => {
              const c = ctx as {
                fetch: (url: string, init?: RequestInit) => Promise<Response>;
              };
              const res = await c.fetch("https://ops.internal.example.com/status");
              observedJson = await res.json();
              return { items: [] };
            },
          },
        },
      },
      enabled: true,
    });

    const result = await pluginRuntime.invoke<{ items: unknown[] }>({
      pluginId: "ops-tool",
      capability: "library",
      version: "v1",
      method: "list",
      input: {},
      scope: "global",
      userId: null,
    });
    expect(result).toEqual({ items: [] });
    expect(observedJson).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith("https://ops.internal.example.com/status", undefined);
  });

  // Regression: the submitted userConfig for startAuth must flow through to
  // ctx.fetch's dynamic host allowlist. Previously runAuth built the context
  // without the userConfig, which caused form-auth plugins (Jellyfin, ...) to
  // reject every user-supplied server URL with "host not in allowlist".
  it("resolves x-allowed-host from startAuth input for form-auth plugins", async () => {
    pluginRows.set("plex-like", {
      id: "plex-like",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });

    let observedBase: string | null = null;
    capabilityRegistry.register({
      pluginId: "plex-like",
      module: {
        ...buildSelfHostedPlugin(async () => ({ items: [] })),
        startAuth: async (ctx, input) => {
          const cfg = input as { baseUrl: string };
          const c = ctx as {
            fetch: (url: string, init?: RequestInit) => Promise<Response>;
          };
          await c.fetch(`${cfg.baseUrl}/auth`);
          observedBase = cfg.baseUrl;
          return {
            status: "completed",
            credentials: { token: "t" },
          };
        },
      },
      enabled: true,
    });

    const result = await pluginRuntime.runAuth("plex-like", "startAuth", "user-1", {
      baseUrl: "https://my.plex.box:32400",
    });
    expect(result).toEqual({ status: "completed", credentials: { token: "t" } });
    expect(observedBase).toBe("https://my.plex.box:32400");
    expect(fetchSpy).toHaveBeenCalledWith("https://my.plex.box:32400/auth", undefined);
  });

  // Regression: a malformed x-allowed-host value (e.g. the user typed "asd"
  // into an URL field) surfaces as a PluginError thrown by buildAuxContext
  // during dynamic-host resolution — BEFORE the plugin's startAuth runs.
  // That throw must be caught and funneled into an AuthResult error
  // preserving params.field, otherwise it escapes as an uncaught 500 and
  // the frontend loses the routing hint.
  it("surfaces x-allowed-host resolution failures as AuthResult errors with params.field", async () => {
    pluginRows.set("plex-like", {
      id: "plex-like",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });

    const startAuthSpy = vi.fn();
    capabilityRegistry.register({
      pluginId: "plex-like",
      module: {
        ...buildSelfHostedPlugin(async () => ({ items: [] })),
        startAuth: async (_ctx, _input) => {
          startAuthSpy();
          return { status: "completed", credentials: { token: "t" } };
        },
      },
      enabled: true,
    });

    const result = await pluginRuntime.runAuth("plex-like", "startAuth", "user-1", {
      baseUrl: "asd",
    });

    expect(result).toMatchObject({
      status: "error",
      code: "plugin.invalid_base_url",
      params: { field: "baseUrl" },
    });
    expect(startAuthSpy).not.toHaveBeenCalled();
    // captureError is called with the plugin.invalid_base_url code; severity
    // routing lives in the shared captureError (covered by capture.test.ts),
    // so asserting `code` here is enough to lock in the info classification
    // for this path.
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [, meta] = captureErrorMock.mock.calls[0]!;
    expect(meta).toMatchObject({
      source: "plugin",
      code: "plugin.invalid_base_url",
      pluginId: "plex-like",
    });
  });

  // Regression: an `x-allowed-host` field on a `sharedCredentialsSchema` whose
  // submitted value is malformed must return a friendly { ok: false, message }
  // instead of bubbling out of `runSharedCredentialProbe` as an uncaught throw.
  // The `/shared-credentials/:credId/test` route has no outer try/catch, so an
  // escape would surface as a 500 to the admin instead of a row-local error.
  it("returns { ok: false } when x-allowed-host on sharedCredentialsSchema is malformed", async () => {
    pluginRows.set("ops-tool", {
      id: "ops-tool",
      globalConfig: null,
      manifest: "{}",
      personalKeyFallback: "off",
    });

    const verifyShared = vi.fn();
    capabilityRegistry.register({
      pluginId: "ops-tool",
      module: {
        manifest: {
          id: "ops-tool",
          name: "Ops",
          version: "1.0.0",
          description: "",
          author: { name: "t" },
          sdkVersion: "^1.0.0",
          allowedHosts: [],
          sharedCredentialsSchema: {
            type: "object",
            properties: {
              baseUrl: { type: "string", "x-allowed-host": true },
              apiKey: { type: "string", "x-secret": true },
            },
          },
          credentialsSchema: { type: "object" },
          auth: { kind: "form" },
          capabilities: { library: { version: "v1", scope: "global" } },
          poolable: true,
        },
        capabilities: {
          library: { list: async () => ({ items: [] }) },
        },
        verifyShared,
      },
      enabled: true,
    });

    const result = await pluginRuntime.testSharedCredentialEphemeral("ops-tool", {
      baseUrl: "asd",
      apiKey: "k",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("x-allowed-host");
    expect(verifyShared).not.toHaveBeenCalled();
  });
});
