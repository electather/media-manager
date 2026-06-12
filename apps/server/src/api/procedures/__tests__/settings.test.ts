import { describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { HttpError } from "../../../diagnostics/http-errors";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let mockUserId: string | null = null;

vi.mock("../../../auth", async () => {
  const { unauthorized } = await import("../../../diagnostics/http-errors");
  return {
    requireSession: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      if (!mockUserId) throw unauthorized();
      c.set("session", { user: { id: mockUserId } });
      await next();
    },
    sessionUserId: (c: { get: (k: string) => unknown }) => {
      const session = c.get("session") as { user: { id: string } } | undefined;
      if (!session) throw unauthorized();
      return session.user.id;
    },
  };
});

const { settingsApp } = await import("../settings");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/settings", settingsApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

describe("settings API", () => {
  it("GET / returns 401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await buildApp().request("/settings");
    expect(res.status).toBe(401);
  });

  it("PUT / returns 401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await buildApp().request("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("GET / returns 200 with settings when authenticated", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/settings");
    expect(res.status).toBe(200);
  });

  it("PUT / returns 200 when authenticated with valid body", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { theme: "dark" } }),
    });
    expect(res.status).toBe(200);
  });
});
