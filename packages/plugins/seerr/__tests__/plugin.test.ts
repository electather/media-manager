import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import { makeTestContext, statusRes } from "@ent-mcp/plugin-sdk/testing";
import seerrPlugin from "../src/plugin";

describe("seerr plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", async () => {
    expect(validatePluginModule(seerrPlugin)).toBeDefined();
  });
});

describe("seerr manifest privacy invariants", () => {
  // These assertions guard the issue #319 fix at the manifest level so a
  // future edit cannot accidentally re-introduce plaintext password storage
  // without tripping the suite.
  it("marks password with both x-secret and writeOnly", () => {
    const props = (
      seerrPlugin.manifest.userConfigSchema as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    expect(props.password?.["x-secret"]).toBe(true);
    expect(props.password?.writeOnly).toBe(true);
  });

  it("promotes the password into credentialsSchema — it must never be persisted to userConfig", () => {
    const credProps = (
      seerrPlugin.manifest.credentialsSchema as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    expect(credProps.password?.type).toBe("string");
    expect(
      (
        seerrPlugin.manifest.userConfigSchema as {
          required: string[];
        }
      ).required,
    ).not.toContain("password");
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

  it("startAuth: returns error when baseUrl uses http on a non-loopback host", async () => {
    // Guards issue #332: credentials must never be POSTed over cleartext http
    // to a remote host, so a non-HTTPS baseUrl is rejected before any fetch.
    const ctx = makeTestContext({
      responses: [],
      overrides: {
        config: { global: { baseUrl: "http://seerr.example.com" }, user: null },
      },
    });
    const result = await seerrPlugin.startAuth!(ctx, { username: "u@example.com", password: "pw" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("plugin.bad_credentials");
    }
  });

  it("startAuth: allows http on localhost for development", async () => {
    const ctx = makeTestContext({
      responses: [
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "set-cookie": "connect.sid=abc; Path=/; HttpOnly" },
        }),
      ],
      overrides: {
        config: { global: { baseUrl: "http://localhost:5055" }, user: null },
      },
    });
    const result = await seerrPlugin.startAuth!(ctx, { username: "u@example.com", password: "pw" });
    expect(result.status).toBe("completed");
  });

  it("startAuth: userConfigPatch nulls the password on success", async () => {
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
      expect(result.userConfigPatch).toEqual({ password: null });
    }
  });

  it("startAuth: persists submitted password into credentials on success", async () => {
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
      const creds = result.credentials as { password?: string };
      expect(creds.password).toBe("pw");
    }
  });

  it("startAuth: re-auth uses password from prior credentials when userConfig omits it", async () => {
    // Simulates the updateUserConfig path: the form-stripped userConfig has no
    // password, but startAuth is invoked with the prior encrypted credentials
    // exposed via ctx.credentials.
    const ctx = makeTestContext({
      responses: [
        new Response(JSON.stringify({ id: 7 }), {
          status: 200,
          headers: { "set-cookie": "connect.sid=new-session; Path=/; HttpOnly" },
        }),
      ],
      overrides: {
        config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
        credentials: { sessionCookie: "connect.sid=old", userId: 7, password: "kept" },
      },
    });
    const result = await seerrPlugin.startAuth!(ctx, {
      username: "u@example.com",
      // No password in incoming config — mirrors the stripped edit-form payload.
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const creds = result.credentials as { sessionCookie: string; password?: string };
      expect(creds.sessionCookie).toContain("connect.sid=new-session");
      expect(creds.password).toBe("kept");
    }
  });

  it("startAuth: returns plugin.input_invalid with field=password when no password is anywhere", async () => {
    const ctx = makeTestContext({
      responses: [],
      overrides: {
        config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
      },
    });
    const result = await seerrPlugin.startAuth!(ctx, { username: "u@example.com" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("plugin.input_invalid");
      expect(result.params?.field).toBe("password");
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
