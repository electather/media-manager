import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// `worker.ts` is the Cloudflare Workers entry point. Cloudflare runs a
// deploy-time validator that loads the module once without making any
// requests; anything that touches the network or reads env/secrets at
// module init will crash that sweep. These tests pin the invariant that
// module init stays inside a small allow-list of synchronous calls and
// that anything touching `env` or the DB is deferred until the first
// request.

const registerBuiltinPluginsMock = vi.fn();
const bootstrapMcpHostToolsMock = vi.fn();
const getDbMock = vi.fn();
const registerErrorSinkMock = vi.fn();
const bootstrapBuiltinsMock = vi.fn(async () => {});

vi.mock("../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

vi.mock("../db/client", () => ({
  getDb: (...args: unknown[]) => getDbMock(...args),
}));

vi.mock("../errors/capture", () => ({
  registerErrorSink: (...args: unknown[]) => registerErrorSinkMock(...args),
  captureError: vi.fn(async () => {}),
}));

vi.mock("../errors/database-sink", () => ({
  DatabaseSink: class {},
}));

vi.mock("../plugins/builtin", () => ({
  registerBuiltinPlugins: (...args: unknown[]) => registerBuiltinPluginsMock(...args),
}));

vi.mock("../mcp/bootstrap", () => ({
  bootstrapMcpHostTools: (...args: unknown[]) => bootstrapMcpHostToolsMock(...args),
}));

vi.mock("../plugin-runtime/runtime", () => ({
  pluginRuntime: {
    bootstrapBuiltins: () => bootstrapBuiltinsMock(),
  },
}));

vi.mock("../api/router", async () => {
  const { Hono } = await import("hono");
  return { appRouter: new Hono() };
});

vi.mock("../auth/oauth-handler", () => ({
  authRouteHandler: vi.fn(async () => new Response(null)),
}));

vi.mock("../mcp/server", () => ({
  createMcpHandler: () => async () => new Response(null),
  oauthAuthorizationServerHandler: vi.fn(async () => new Response(null)),
  oauthProtectedResourceHandler: vi.fn(async () => new Response(null)),
}));

describe("cloudflare worker entry", () => {
  beforeEach(() => {
    registerBuiltinPluginsMock.mockClear();
    bootstrapMcpHostToolsMock.mockClear();
    getDbMock.mockClear();
    registerErrorSinkMock.mockClear();
    bootstrapBuiltinsMock.mockClear();
    vi.resetModules();
  });

  it("exports a Hono app with a fetch handler as default", async () => {
    const worker = (await import("../worker")).default;
    expect(worker).toBeDefined();
    expect(typeof worker.fetch).toBe("function");
  });

  it("runs only sync registration at module init, defers DB + plugins to first request", async () => {
    await import("../worker");
    expect(registerBuiltinPluginsMock).toHaveBeenCalledTimes(1);
    expect(bootstrapMcpHostToolsMock).toHaveBeenCalledTimes(1);
    // These are the Workers-hostile calls. They must NOT fire at module
    // init because the deploy validator runs before `env` is populated.
    expect(getDbMock).not.toHaveBeenCalled();
    expect(registerErrorSinkMock).not.toHaveBeenCalled();
    expect(bootstrapBuiltinsMock).not.toHaveBeenCalled();
  });

  it("runs deferred init exactly once across concurrent first requests", async () => {
    const worker = (await import("../worker")).default;
    const req = () => new Request("http://localhost/api/anything");
    await Promise.all([worker.fetch(req()), worker.fetch(req()), worker.fetch(req())]);
    expect(getDbMock).toHaveBeenCalledTimes(1);
    expect(registerErrorSinkMock).toHaveBeenCalledTimes(1);
    expect(bootstrapBuiltinsMock).toHaveBeenCalledTimes(1);
  });

  it("retries deferred init on the next request after a transient failure", async () => {
    // A rejected init promise must not be cached — otherwise every later
    // request short-circuits to the same error until the Worker is
    // redeployed. Simulate a transient Turso failure on the first request
    // and verify the second request re-runs init and succeeds.
    bootstrapBuiltinsMock.mockRejectedValueOnce(new Error("transient turso failure"));
    const worker = (await import("../worker")).default;
    const req = () => new Request("http://localhost/api/anything");

    const first = await worker.fetch(req());
    expect(first.status).toBeGreaterThanOrEqual(500);
    expect(bootstrapBuiltinsMock).toHaveBeenCalledTimes(1);

    const second = await worker.fetch(req());
    expect(second.status).toBeLessThan(500);
    expect(bootstrapBuiltinsMock).toHaveBeenCalledTimes(2);
  });

  it("does not import Bun-only modules (hono/bun, croner, migrate)", async () => {
    // Static guard: `worker.ts` is read as text and scanned for imports of
    // modules that either require a Bun/Node runtime or perform a startup
    // DB write. This is intentionally string-based so the check survives
    // even if the module-level `vi.mock` surface silently hides a new
    // offending import.
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(fileURLToPath(new URL("../worker.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/from\s+["']hono\/bun["']/);
    expect(source).not.toMatch(/from\s+["']croner["']/);
    expect(source).not.toMatch(/from\s+["']\.\/db\/migrate["']/);
    expect(source).not.toMatch(/from\s+["']\.\/jobs\/scheduler["']/);
  });
});
