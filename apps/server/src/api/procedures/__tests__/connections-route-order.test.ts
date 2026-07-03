import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";

// Regression for route-order shadowing: `.route("/primary", ...)` must be
// matched before the dynamic `.delete("/:id")` handler, otherwise
// `DELETE /connections/primary` lands on `connectionsService.delete` with
// `id = "primary"` instead of the primary sub-app's clear handler.

const connectionsServiceMock = {
  listForUser: vi.fn(async () => []),
  listAvailablePlugins: vi.fn(async () => []),
  getUserConfig: vi.fn(async () => ({})),
  verifyConfig: vi.fn(async () => ({ ok: true })),
  createFormConnection: vi.fn(async () => ({ id: "stub" })),
  updateDisplayName: vi.fn(async () => undefined),
  updateUserConfig: vi.fn(async () => undefined),
  setEnabled: vi.fn(async () => undefined),
  setDefault: vi.fn(async () => undefined),
  test: vi.fn(async () => ({ ok: true })),
  delete: vi.fn(async () => undefined),
  initiateRedirectAuth: vi.fn(async () => ({ url: "" })),
  completeRedirectAuth: vi.fn(async () => ({ ok: true })),
  initiateDeviceAuth: vi.fn(async () => ({ deviceCode: "" })),
  pollDeviceAuth: vi.fn(async () => ({ status: "pending" })),
};

const primaryServiceMock = {
  listForUser: vi.fn(async () => []),
  set: vi.fn(async () => undefined),
  clear: vi.fn(async () => undefined),
};

vi.mock("../../../connections/service", () => ({
  connectionsService: connectionsServiceMock,
}));

vi.mock("../../../connections/primary-service", () => ({
  primaryConnectionsService: primaryServiceMock,
}));

// Env is validated at module load once connectionsApp pulls in `../rate-limit`;
// stub it so the suite doesn't depend on real deployment secrets (CI has none).
vi.mock("../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

vi.mock("../../../auth", () => ({
  requireSession: async (c: any, next: any) => {
    // Session user id defaults to "u1"; tests override via x-test-user to
    // exercise per-user bucket isolation.
    c.set("session", { user: { id: c.req.header("x-test-user") ?? "u1" } });
    await next();
  },
  requirePermission: (_p: string) => async (_c: any, next: any) => {
    await next();
  },
  sessionUserId: (c: any) => c.get("session").user.id,
  PERMISSIONS: { ACCOUNT_CONNECTIONS: "account:connections" },
}));

const { connectionsApp, connectionPluginLimiter, connectionPollLimiter } =
  await import("../connections");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/connections", connectionsApp)
    .onError(errorHandler);
}

beforeEach(() => {
  connectionsServiceMock.delete.mockClear();
  primaryServiceMock.clear.mockClear();
  primaryServiceMock.set.mockClear();
  primaryServiceMock.listForUser.mockClear();
});

describe("connectionsApp — route ordering", () => {
  it("routes DELETE /connections/primary to the primary sub-app, not the dynamic /:id handler", async () => {
    const res = await buildApp().request("/connections/primary", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capabilityKey: "metadata@v1", mediaType: "movie" }),
    });
    expect(res.status).toBe(200);
    expect(primaryServiceMock.clear).toHaveBeenCalledWith({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "movie",
    });
    expect(connectionsServiceMock.delete).not.toHaveBeenCalled();
  });

  it("routes POST /connections/primary to the primary sub-app", async () => {
    const res = await buildApp().request("/connections/primary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityKey: "metadata@v1",
        mediaType: "movie",
        connectionId: "11111111-1111-4111-8111-111111111111",
      }),
    });
    expect(res.status).toBe(200);
    expect(primaryServiceMock.set).toHaveBeenCalled();
  });

  it("routes GET /connections/primary to the primary sub-app", async () => {
    const res = await buildApp().request("/connections/primary");
    expect(res.status).toBe(200);
    expect(primaryServiceMock.listForUser).toHaveBeenCalledWith("u1");
  });

  it("still routes DELETE /connections/:id to the dynamic handler for non-primary ids", async () => {
    const res = await buildApp().request("/connections/some-id", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(connectionsServiceMock.delete).toHaveBeenCalledWith({
      userId: "u1",
      connectionId: "some-id",
    });
  });
});

describe("connectionsApp — per-user rate limiting (#922)", () => {
  // Debit runs before zValidator, so a drained bucket short-circuits with 429
  // regardless of body validity — assertions key on 429 alone, not handler output.
  beforeEach(() => {
    connectionPluginLimiter.reset();
    connectionPollLimiter.reset();
  });

  function post(path: string, user?: string) {
    return buildApp().request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: "{}",
    });
  }

  it("throttles verify-config with 429 + Retry-After once the one-shot bucket (capacity 20) drains", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await post("/connections/verify-config")).status).not.toBe(429);
    }
    const drained = await post("/connections/verify-config");
    expect(drained.status).toBe(429);
    expect(drained.headers.get("Retry-After")).not.toBeNull();
  });

  it("shares one bucket across create and update — both run an outbound startAuth", async () => {
    // POST / and PATCH /:id/user-config attach the limiter per-method; drain via
    // create, then confirm the update route is already throttled on the same bucket.
    for (let i = 0; i < 20; i++) {
      const res = await post("/connections");
      // Debit precedes zValidator, so an empty body yields 400 (not 404/429) — never throttled here.
      expect(res.status).toBe(400);
    }
    const patch = await buildApp().request("/connections/some-id/user-config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(patch.status).toBe(429);
  });

  it("does not throttle device polling below the advertised cadence, but caps the poll bucket at capacity", async () => {
    // Plex advertises intervalSec: 2 (30 polls/min), which the old shared 20/min
    // bucket would 429 mid-flow before the PIN expires. The dedicated poll bucket must not.
    for (let i = 0; i < 60; i++) {
      expect((await post("/connections/oauth/device/poll")).status).not.toBe(429);
    }
    // Ceiling guard: a misconfigured (e.g. Infinity) bucket would never throttle.
    expect((await post("/connections/oauth/device/poll")).status).toBe(429);
  });

  it("isolates buckets per user — draining u1 does not throttle u2", async () => {
    for (let i = 0; i < 21; i++) await post("/connections/verify-config", "u1");
    expect((await post("/connections/verify-config", "u1")).status).toBe(429);
    expect((await post("/connections/verify-config", "u2")).status).not.toBe(429);
  });

  it("does not consume a token on unguarded reads (GET /connections/available)", async () => {
    // Well past both bucket capacities — an unguarded route must never 429.
    for (let i = 0; i < 25; i++) {
      expect((await buildApp().request("/connections/available")).status).toBe(200);
    }
  });
});
