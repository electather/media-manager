import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Both branches of `EMAIL_PROVIDER_CONFIGURED` need their own module instance
// because `configPublicApp` reads `env` at handler-evaluation time. Reset
// modules between tests and use `vi.doMock` so each `import("../config")` picks
// up the matching mocked env value. Both branch assertions are required by the
// design spec — the email-gated UI flag is the entire reason this endpoint
// exists.

describe("configPublicApp", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../../../env");
  });

  it("returns emailEnabled: true when EMAIL_PROVIDER_CONFIGURED is true", async () => {
    vi.doMock("../../../env", () => ({
      env: { EMAIL_PROVIDER_CONFIGURED: true },
    }));
    const { configPublicApp } = await import("../config");

    const res = await configPublicApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emailEnabled: boolean };
    expect(body).toEqual({ emailEnabled: true });
  });

  it("returns emailEnabled: false when EMAIL_PROVIDER_CONFIGURED is false", async () => {
    vi.doMock("../../../env", () => ({
      env: { EMAIL_PROVIDER_CONFIGURED: false },
    }));
    const { configPublicApp } = await import("../config");

    const res = await configPublicApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emailEnabled: boolean };
    expect(body).toEqual({ emailEnabled: false });
  });
});
