import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Reset modules + `vi.doMock` per test so each `import("../config")` picks up matching env. Both EMAIL_PROVIDER_CONFIGURED branches required by design spec.
// Mock auth to avoid betterAuth instance load (reads BETTER_AUTH_URL, touches db) — only flag needed.

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
