import { describe, it, expect } from "vite-plus/test";
import { isPluginError } from "@ent-mcp/plugin-sdk";
import { refreshAuth, refreshTokensJob } from "../src/auth";
import { makeCtx } from "./helpers";

const okBody = {
  access_token: "new-access",
  refresh_token: "new-refresh",
  created_at: 1_700_000_000,
  expires_in: 7776000,
};

function jsonRes(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function assertPluginError(err: unknown): asserts err is {
  name: "PluginError";
  code: string;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
} {
  expect(isPluginError(err)).toBe(true);
}

describe("refreshAuth", () => {
  it("maps 429 with Retry-After (seconds) to plugin.rate_limited carrying retryAfterMs", async () => {
    const ctx = makeCtx([new Response("", { status: 429, headers: { "retry-after": "600" } })]);
    try {
      await refreshAuth(ctx, ctx.credentials);
      throw new Error("should have thrown");
    } catch (err) {
      assertPluginError(err);
      expect(err.code).toBe("plugin.rate_limited");
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(600_000);
    }
  });

  it("maps 429 without Retry-After to plugin.rate_limited with a 5-minute default", async () => {
    const ctx = makeCtx([new Response("", { status: 429 })]);
    try {
      await refreshAuth(ctx, ctx.credentials);
      throw new Error("should have thrown");
    } catch (err) {
      assertPluginError(err);
      expect(err.code).toBe("plugin.rate_limited");
      expect(err.retryAfterMs).toBe(300_000);
    }
  });

  it("clamps 429 Retry-After above 1h to the 3_600_000ms ceiling", async () => {
    const ctx = makeCtx([new Response("", { status: 429, headers: { "retry-after": "7200" } })]);
    try {
      await refreshAuth(ctx, ctx.credentials);
      throw new Error("should have thrown");
    } catch (err) {
      assertPluginError(err);
      expect(err.code).toBe("plugin.rate_limited");
      expect(err.retryAfterMs).toBe(3_600_000);
    }
  });

  it("maps 429 with a past HTTP-date Retry-After to 0ms (delta clamped to zero)", async () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString();
    const ctx = makeCtx([new Response("", { status: 429, headers: { "retry-after": pastDate } })]);
    try {
      await refreshAuth(ctx, ctx.credentials);
      throw new Error("should have thrown");
    } catch (err) {
      assertPluginError(err);
      expect(err.code).toBe("plugin.rate_limited");
      expect(err.retryAfterMs).toBe(0);
    }
  });

  it("maps 429 with a future HTTP-date Retry-After to the delta capped at 1h", async () => {
    const futureDate = new Date(Date.now() + 1_200_000).toUTCString();
    const ctx = makeCtx([
      new Response("", { status: 429, headers: { "retry-after": futureDate } }),
    ]);
    try {
      await refreshAuth(ctx, ctx.credentials);
      throw new Error("should have thrown");
    } catch (err) {
      assertPluginError(err);
      expect(err.code).toBe("plugin.rate_limited");
      expect(err.retryAfterMs).toBeGreaterThan(0);
      expect(err.retryAfterMs).toBeLessThanOrEqual(3_600_000);
    }
  });

  it("still maps non-429 4xx responses to plugin.token_expired", async () => {
    const ctx = makeCtx([new Response("", { status: 401 })]);
    try {
      await refreshAuth(ctx, ctx.credentials);
      throw new Error("should have thrown");
    } catch (err) {
      assertPluginError(err);
      expect(err.code).toBe("plugin.token_expired");
    }
  });

  it("maps 5xx to plugin.upstream_error", async () => {
    const ctx = makeCtx([new Response("", { status: 503 })]);
    try {
      await refreshAuth(ctx, ctx.credentials);
      throw new Error("should have thrown");
    } catch (err) {
      assertPluginError(err);
      expect(err.code).toBe("plugin.upstream_error");
    }
  });

  it("parses refreshed credentials on 200", async () => {
    const ctx = makeCtx([jsonRes(okBody)]);
    const out = await refreshAuth(ctx, ctx.credentials);
    expect(out.accessToken).toBe("new-access");
    expect(out.refreshToken).toBe("new-refresh");
    expect(out.createdAt).toBe(okBody.created_at * 1000);
    expect(out.expiresIn).toBe(okBody.expires_in);
  });
});

describe("refreshTokensJob", () => {
  it("returns null and does not fetch when credentials are not close to expiry", async () => {
    const ctx = makeCtx([], {
      credentials: {
        accessToken: "a",
        refreshToken: "r",
        createdAt: Date.now(),
        expiresIn: 7 * 24 * 60 * 60,
      },
    });
    const out = await refreshTokensJob(ctx);
    expect(out).toBeNull();
    expect(ctx.calls.length).toBe(0);
  });

  it("propagates plugin.rate_limited from 429 during the refresh job", async () => {
    const ctx = makeCtx([new Response("", { status: 429, headers: { "retry-after": "120" } })], {
      credentials: {
        accessToken: "a",
        refreshToken: "r",
        createdAt: Date.now() - 1000,
        expiresIn: 60,
      },
    });
    try {
      await refreshTokensJob(ctx);
      throw new Error("should have thrown");
    } catch (err) {
      assertPluginError(err);
      expect(err.code).toBe("plugin.rate_limited");
      expect(err.retryAfterMs).toBe(120_000);
    }
  });
});
