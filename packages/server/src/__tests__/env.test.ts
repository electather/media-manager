import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// These env vars are every required key our env schema validates. Tests mutate
// `process.env` and rely on `vi.resetModules()` so each import re-runs the
// schema against the current environment.
const VALID_ENV: Record<string, string> = {
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  APP_EXTERNAL_URL: "https://media.example.com",
};

describe("server env schema", () => {
  const originalEnv = { ...process.env };
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit called");
  }) as never);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.resetModules();
    exitSpy.mockClear();
    errorSpy.mockClear();
    for (const key of Object.keys(process.env)) {
      if (key in VALID_ENV) delete process.env[key];
    }
    for (const [k, v] of Object.entries(VALID_ENV)) {
      process.env[k] = v;
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts a valid APP_EXTERNAL_URL", async () => {
    process.env.APP_EXTERNAL_URL = "https://media.example.com";
    const { env } = await import("../env");
    expect(env.APP_EXTERNAL_URL).toBe("https://media.example.com");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("fails startup when APP_EXTERNAL_URL is missing", async () => {
    delete process.env.APP_EXTERNAL_URL;
    await expect(import("../env")).rejects.toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const issues = errorSpy.mock.calls.flat().flat();
    const asString = JSON.stringify(issues);
    expect(asString).toContain("APP_EXTERNAL_URL");
  });

  it("fails startup when APP_EXTERNAL_URL is not a URL", async () => {
    process.env.APP_EXTERNAL_URL = "not-a-url";
    await expect(import("../env")).rejects.toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const issues = errorSpy.mock.calls.flat().flat();
    const asString = JSON.stringify(issues);
    expect(asString).toContain("APP_EXTERNAL_URL");
  });

  it("rejects non-http(s) schemes (e.g. file://)", async () => {
    process.env.APP_EXTERNAL_URL = "file:///etc/passwd";
    await expect(import("../env")).rejects.toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const issues = errorSpy.mock.calls.flat().flat();
    expect(JSON.stringify(issues)).toContain("APP_EXTERNAL_URL");
  });

  it("strips trailing slashes so plugins can safely append paths", async () => {
    process.env.APP_EXTERNAL_URL = "https://media.example.com/";
    const { env } = await import("../env");
    expect(env.APP_EXTERNAL_URL).toBe("https://media.example.com");
  });

  it("strips multiple trailing slashes", async () => {
    process.env.APP_EXTERNAL_URL = "https://media.example.com///";
    const { env } = await import("../env");
    expect(env.APP_EXTERNAL_URL).toBe("https://media.example.com");
  });
});
