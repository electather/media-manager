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

// The home procedure is layout-only after the §A8 cutover: row content, title
// details, and season availability serve from `api.media.*`. Only `composeLayout`
// + its `buildContext` ctor remain wired through this procedure.
vi.mock("../../../home", async () => {
  const actual = await vi.importActual<typeof import("../../../home")>("../../../home");
  return {
    ...actual,
    buildContext: vi.fn().mockReturnValue({ userId: "u1" }),
    composeLayout: vi.fn(),
  };
});

const home = await import("../../../home");
const { homeApp } = await import("../home");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/home", homeApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

describe("home API", () => {
  it("returns 401 when no session present", async () => {
    mockUserId = null;
    const res = await buildApp().request("/home/layout");
    expect(res.status).toBe(401);
  });

  it("returns 200 + layout for authenticated user", async () => {
    mockUserId = "u1";
    const fake = { hero: null, rows: [], generatedAt: 1 };
    vi.mocked(home.composeLayout).mockResolvedValueOnce(fake);
    const res = await buildApp().request("/home/layout");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fake);
  });

  it("returns 404 + JSON envelope on wrong-method requests to known paths", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/home/layout", { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; requestId: string };
    expect(body.code).toBe("http.not_found");
    expect(body.requestId).toBeTypeOf("string");
  });

  it("returns 404 on the deleted /row sub-path (now served from api.media.*)", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/home/row?rowId=trendingNow");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("http.not_found");
  });

  it("returns 404 + JSON envelope on unknown sub-paths", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/home/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("http.not_found");
  });
});
