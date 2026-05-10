import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { unauthorized } from "../../../diagnostics/http-errors";

// Stub the env so anything transitively pulled by the auth/db modules at
// import time doesn't trip over missing process env.
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

// Toggle whether `requireSession` accepts the request, and which userId it
// surfaces. The `meApp` reads `sessionUserId(c)` so we wire that up too.
let mockUserId: string | null = null;

vi.mock("../../../auth/middleware", () => ({
  requireSession: async (c: any, next: any) => {
    if (!mockUserId) {
      throw unauthorized();
    }
    c.set("session", { user: { id: mockUserId } });
    await next();
  },
  sessionUserId: (c: any) => {
    const session = c.get("session") as { user: { id: string } } | undefined;
    if (!session) throw unauthorized();
    return session.user.id;
  },
  requirePermission: () => async (_c: any, next: any) => {
    await next();
  },
}));

// Drive the `/role` query result by swapping `getDb` for a tiny stub that
// records the where-clause the handler used and returns whatever row the
// test arranged.
let mockRoleRow: { name: string; description: string | null } | undefined;
let lastWhereClause: { column?: string; value?: unknown } | undefined;

vi.mock("../../../db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (clause: { column?: string; value?: unknown }) => ({
            get: () => {
              lastWhereClause = clause;
              return mockRoleRow;
            },
          }),
        }),
      }),
    }),
  }),
}));

// Fake drizzle-orm `eq` so the chained builder above can capture both the
// column name and value used in the where clause without a real database.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => ({
      column: column?.name,
      value,
    }),
  };
});

const { meApp } = await import("../me");

function buildApp() {
  // Mirror the real router so `requestContextMiddleware` + `errorHandler`
  // are in play; that way HttpErrors thrown by middleware/handlers come back
  // as the structured JSON the client actually sees.
  return new Hono().use("*", requestContextMiddleware()).route("/me", meApp).onError(errorHandler);
}

describe("meApp GET /role", () => {
  beforeEach(() => {
    mockUserId = null;
    mockRoleRow = undefined;
    lastWhereClause = undefined;
  });

  it("returns the assigned role for the authenticated user", async () => {
    mockUserId = "user-1";
    mockRoleRow = { name: "Admin", description: "Has every permission." };

    const res = await buildApp().request("/me/role");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      role: { name: "Admin", description: "Has every permission." },
    });
    expect(lastWhereClause?.column).toBe("user_id");
    expect(lastWhereClause?.value).toBe("user-1");
  });

  it("returns 200 with role:null when the user has no role assignment", async () => {
    mockUserId = "user-no-role";
    mockRoleRow = undefined;

    const res = await buildApp().request("/me/role");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: null });
    expect(lastWhereClause?.column).toBe("user_id");
    expect(lastWhereClause?.value).toBe("user-no-role");
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mockUserId = null;

    const res = await buildApp().request("/me/role");

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("http.unauthorized");
  });
});
