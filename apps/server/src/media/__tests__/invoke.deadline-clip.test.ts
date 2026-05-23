import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const invokeWithCredentialsMock = vi.fn();
vi.mock("../../plugin-runtime", () => ({
  pluginRuntime: {
    invokeWithCredentials: (...args: unknown[]) => invokeWithCredentialsMock(...args),
  },
  capabilityRegistry: { all: () => [] },
}));

import type { ResolvedConnection } from "../internal/resolve-connection";

const { invokeWithTimeout } = await import("../service/invoke");

const conn: ResolvedConnection = {
  kind: "shared",
  pluginId: "trakt",
  connectionId: null,
  credentials: {},
  userConfig: null,
};

function baseReq(overrides: { timeoutMs: number; deadlineMs?: number }) {
  return {
    userId: "user-1",
    pluginId: "trakt",
    capability: "continueWatching",
    version: "v1",
    method: "getContinueWatching",
    input: {},
    ...overrides,
  };
}

describe("invokeWithTimeout deadline clip", () => {
  beforeEach(() => {
    invokeWithCredentialsMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses req.timeoutMs when deadlineMs is absent", async () => {
    invokeWithCredentialsMock.mockResolvedValue({ ok: true });
    const result = await invokeWithTimeout(baseReq({ timeoutMs: 5_000 }), conn);
    expect(result).toEqual({ ok: true });
  });

  it("clips effective timer to remaining budget when shorter than timeoutMs", async () => {
    const now = Date.now();
    invokeWithCredentialsMock.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    const promise = invokeWithTimeout(
      baseReq({ timeoutMs: 15_000, deadlineMs: now + 2_000 }),
      conn,
    ).catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(2_100);
    const err = (await promise) as Error;
    expect(err.name).toBe("AbortError");
    expect(err.message).toMatch(/cap 15000ms/);
    expect(err.message).toMatch(/timed out after 2000ms|after 199[0-9]ms/);
  });

  it("uses timeoutMs when remaining is greater", async () => {
    const now = Date.now();
    invokeWithCredentialsMock.mockImplementation(() => new Promise(() => {}));
    const promise = invokeWithTimeout(
      baseReq({ timeoutMs: 3_000, deadlineMs: now + 60_000 }),
      conn,
    ).catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(3_100);
    const err = (await promise) as Error;
    expect(err.name).toBe("AbortError");
    expect(err.message).toMatch(/timed out after 3000ms/);
  });

  it("short-circuits to AbortError when remaining ≤ 50ms without arming timer", async () => {
    const now = Date.now();
    const err = await invokeWithTimeout(
      baseReq({ timeoutMs: 15_000, deadlineMs: now + 10 }),
      conn,
    ).catch((e: Error) => e);
    expect((err as Error).name).toBe("AbortError");
    expect((err as Error).message).toMatch(/deadline_exceeded/);
    expect(invokeWithCredentialsMock).not.toHaveBeenCalled();
  });

  it("short-circuits when deadline already in the past (negative remaining)", async () => {
    const now = Date.now();
    const err = await invokeWithTimeout(
      baseReq({ timeoutMs: 15_000, deadlineMs: now - 1_000 }),
      conn,
    ).catch((e: Error) => e);
    expect((err as Error).name).toBe("AbortError");
    expect(invokeWithCredentialsMock).not.toHaveBeenCalled();
  });
});
