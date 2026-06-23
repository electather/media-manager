// Verify invokeOne writes terminal "error" status only for non-recoverable codes
// (plugin.bad_credentials, plugin.internal), not transient ones (plugin.upstream_error).
import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { PluginError } from "@nama/plugin-sdk";

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

const markConnectionStatusMock = vi.fn();
vi.mock("../service/connection-lifecycle", () => ({
  markConnectionStatus: (...args: unknown[]) => markConnectionStatusMock(...args),
  refreshConnectionCredentials: vi.fn(),
  emitAuthExpired: vi.fn(),
  persistRefreshedCredentials: vi.fn(),
}));

import type { ResolvedConnection } from "../internal/resolve-connection";

const { invokeOne } = await import("../service/invoke");

const userConn: ResolvedConnection = {
  kind: "user",
  pluginId: "trakt",
  connectionId: "conn-1",
  isDefault: true,
  credentials: { token: "t" },
  userConfig: {},
};

function baseReq() {
  return {
    userId: "user-1",
    pluginId: "trakt",
    capability: "metadata",
    version: "v1",
    method: "getDetails",
    input: {},
    timeoutMs: 5_000,
  };
}

describe("invokeOne connection status on terminal error", () => {
  beforeEach(() => {
    invokeWithCredentialsMock.mockReset();
    markConnectionStatusMock.mockReset();
    markConnectionStatusMock.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not mark connection as error when upstream_error exhausts retry budget", async () => {
    // Both the initial call and the one transient retry fail with upstream_error.
    // The connection should not be marked "error" because upstream_error is a
    // transient code that reflects a temporary outage, not a terminal condition.
    invokeWithCredentialsMock
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "upstream 500"))
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "still down"));

    const promise = invokeOne(baseReq(), userConn);
    await vi.advanceTimersByTimeAsync(1_500);
    const outcome = await promise;

    expect(outcome.error?.code).toBe("plugin.upstream_error");
    expect(markConnectionStatusMock).not.toHaveBeenCalled();
  });

  it("marks connection as error when bad_credentials is returned", async () => {
    // bad_credentials is a terminal, non-transient code — the user's OAuth
    // credentials have been permanently revoked or invalidated. Marking the
    // connection "error" is the correct behaviour here.
    invokeWithCredentialsMock.mockRejectedValueOnce(
      new PluginError("plugin.bad_credentials", "401 invalid token"),
    );

    const outcome = await invokeOne(baseReq(), userConn);

    expect(outcome.error?.code).toBe("plugin.bad_credentials");
    expect(markConnectionStatusMock).toHaveBeenCalledWith("conn-1", "error", "401 invalid token");
  });

  it("marks connection as error when plugin.internal is returned", async () => {
    // plugin.internal: non-recoverable bug/unexpected state, per docs/media-service.md
    // Error Handling. Duck-type object since not in HostErrorCode (raw plugin string).
    const internalErr = Object.assign(new Error("unexpected state"), {
      name: "PluginError",
      code: "plugin.internal",
    });
    invokeWithCredentialsMock.mockRejectedValueOnce(internalErr);

    const outcome = await invokeOne(baseReq(), userConn);

    expect(outcome.error?.code).toBe("plugin.internal");
    expect(markConnectionStatusMock).toHaveBeenCalledWith("conn-1", "error", "unexpected state");
  });
});
