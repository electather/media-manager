import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import { makeTestContext, statusRes } from "@ent-mcp/plugin-sdk/testing";
import seerrPlugin from "../src/plugin";

describe("seerr plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", async () => {
    expect(validatePluginModule(seerrPlugin)).toBeDefined();
  });
});

describe("seerr auth lifecycle", () => {
  it("plugin exposes startAuth and testConnection", () => {
    expect(typeof seerrPlugin.startAuth).toBe("function");
    expect(typeof seerrPlugin.testConnection).toBe("function");
  });

  it("startAuth: returns completed with credentials on success", async () => {
    const ctx = makeTestContext({
      responses: [
        new Response(JSON.stringify({ id: 7 }), {
          status: 200,
          headers: { "set-cookie": "connect.sid=abc123; Path=/; HttpOnly" },
        }),
      ],
      overrides: {
        config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
      },
    });
    const result = await seerrPlugin.startAuth!(ctx, { username: "u@example.com", password: "pw" });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const creds = result.credentials as { sessionCookie: string; userId: number };
      expect(creds.sessionCookie).toContain("connect.sid");
      expect(creds.userId).toBe(7);
    }
  });

  it("startAuth: returns error when baseUrl is missing", async () => {
    const ctx = makeTestContext({
      responses: [],
      overrides: { config: { global: null, user: null } },
    });
    const result = await seerrPlugin.startAuth!(ctx, { username: "u@example.com", password: "pw" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("plugin.bad_credentials");
    }
  });

  it("startAuth: returns error on 401", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(401)],
      overrides: {
        config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
      },
    });
    const result = await seerrPlugin.startAuth!(ctx, {
      username: "u@example.com",
      password: "bad",
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("plugin.bad_credentials");
    }
  });

  it("startAuth: returns error on 403", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(403)],
      overrides: {
        config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
      },
    });
    const result = await seerrPlugin.startAuth!(ctx, {
      username: "u@example.com",
      password: "bad",
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("plugin.bad_credentials");
    }
  });

  it("testConnection: returns ok true on 200", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(200)],
      overrides: {
        credentials: { sessionCookie: "connect.sid=xyz", userId: 1 },
        config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
      },
    });
    const result = await seerrPlugin.testConnection!(ctx);
    expect(result.ok).toBe(true);
  });

  it("testConnection: returns ok false on 401", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(401)],
      overrides: {
        credentials: { sessionCookie: "connect.sid=xyz", userId: 1 },
        config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
      },
    });
    const result = await seerrPlugin.testConnection!(ctx);
    expect(result.ok).toBe(false);
  });
});
