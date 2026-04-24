import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../errors/middleware";
import { unauthorized } from "../../../errors/http-errors";

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
// records the userId the handler filtered on and returns whatever row the
// test arranged.
let mockRoleRow: { name: string; description: string | null } | undefined;
let lastWhereUserId: string | undefined;

vi.mock("../../../db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (clause: { userId: string }) => ({
            get: () => {
              lastWhereUserId = clause.userId;
              return mockRoleRow;
            },
          }),
        }),
      }),
    }),
  }),
}));

// Fake drizzle-orm `eq` so the chained builder above can capture the userId
// used in the where clause without spinning up a real database.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => ({
      column: column?.name,
      userId: value as string,
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
    lastWhereUserId = undefined;
  });

  it("returns the assigned role for the authenticated user", async () => {
    mockUserId = "user-1";
    mockRoleRow = { name: "Admin", description: "Has every permission." };

    const res = await buildApp().request("/me/role");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Admin",
      description: "Has every permission.",
    });
    expect(lastWhereUserId).toBe("user-1");
  });

  it("returns 404 when the user has no role assignment", async () => {
    mockUserId = "user-no-role";
    mockRoleRow = undefined;

    const res = await buildApp().request("/me/role");

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("me.role_not_assigned");
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mockUserId = null;

    const res = await buildApp().request("/me/role");

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("http.unauthorized");
  });
});
