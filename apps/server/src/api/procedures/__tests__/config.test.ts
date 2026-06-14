import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Both branches of `EMAIL_PROVIDER_CONFIGURED` need their own module instance
// because `configPublicApp` reads `env` at handler-evaluation time. Reset
// modules between tests and use `vi.doMock` so each `import("../config")` picks
// up the matching mocked env value. Both branch assertions are required by the
// design spec — the email-gated UI flag is the entire reason this endpoint
// exists.
//
// The handler also reads `needsBootstrap()` from the auth barrel. We mock that
// module so importing the handler does not pull in the full betterAuth instance
// (which reads BETTER_AUTH_URL at load time) or touch the database; the handler
// only needs the flag to resolve.

describe("configPublicApp", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../../../env");
    vi.doUnmock("../../../auth");
  });

  it("returns emailEnabled: true plus mcp endpoint + scopes when EMAIL_PROVIDER_CONFIGURED is true", async () => {
    vi.doMock("../../../env", () => ({
      env: {
        EMAIL_PROVIDER_CONFIGURED: true,
        APP_EXTERNAL_URL: "https://media.example.com",
      },
    }));
    vi.doMock("../../../auth", () => ({ needsBootstrap: vi.fn().mockResolvedValue(false) }));
    const { configPublicApp } = await import("../config");
    const { MCP_SCOPES } = await import("@nama/shared/users");

    const res = await configPublicApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      emailEnabled: boolean;
      mcpEndpointUrl: string;
      mcpScopes: string[];
      needsBootstrap: boolean;
    };
    expect(body.emailEnabled).toBe(true);
    expect(body.mcpEndpointUrl).toBe("https://media.example.com/mcp");
    expect(body.mcpScopes).toEqual([...MCP_SCOPES]);
    expect(body.needsBootstrap).toBe(false);
  });

  it("returns emailEnabled: false when EMAIL_PROVIDER_CONFIGURED is false", async () => {
    vi.doMock("../../../env", () => ({
      env: {
        EMAIL_PROVIDER_CONFIGURED: false,
        APP_EXTERNAL_URL: "https://media.example.com",
      },
    }));
    vi.doMock("../../../auth", () => ({ needsBootstrap: vi.fn().mockResolvedValue(false) }));
    const { configPublicApp } = await import("../config");

    const res = await configPublicApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emailEnabled: boolean; mcpEndpointUrl: string };
    expect(body.emailEnabled).toBe(false);
    expect(body.mcpEndpointUrl).toBe("https://media.example.com/mcp");
  });

  it("falls back to request origin when APP_EXTERNAL_URL is missing", async () => {
    vi.doMock("../../../env", () => ({
      env: { EMAIL_PROVIDER_CONFIGURED: true },
    }));
    vi.doMock("../../../auth", () => ({ needsBootstrap: vi.fn().mockResolvedValue(false) }));
    const { configPublicApp } = await import("../config");

    const res = await configPublicApp.request("http://localhost:3000/");
    const body = (await res.json()) as { mcpEndpointUrl: string };
    expect(body.mcpEndpointUrl).toBe("http://localhost:3000/mcp");
  });

  it("surfaces needsBootstrap from the auth module so the client can funnel a fresh install to /bootstrap", async () => {
    vi.doMock("../../../env", () => ({
      env: {
        EMAIL_PROVIDER_CONFIGURED: true,
        APP_EXTERNAL_URL: "https://media.example.com",
      },
    }));
    vi.doMock("../../../auth", () => ({ needsBootstrap: vi.fn().mockResolvedValue(true) }));
    const { configPublicApp } = await import("../config");

    const res = await configPublicApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needsBootstrap: boolean };
    expect(body.needsBootstrap).toBe(true);
  });
});
