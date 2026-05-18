import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// vi.mock calls are hoisted, so set the env mock before importing the module
// under test pulls in better-auth/oauth2 + env.
vi.mock("../../env", () => ({
  env: {
    BETTER_AUTH_URL: "https://example.com",
    BETTER_AUTH_SECRET: "test-secret",
    ENCRYPTION_KEY: "test-key",
    CACHE_PROVIDER: "memory",
  },
}));

const verifyAccessTokenMock = vi.fn();
vi.mock("better-auth/oauth2", () => ({
  verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args),
}));

import { withOAuthAuth } from "../auth";

describe("withOAuthAuth audience verification", () => {
  beforeEach(() => {
    verifyAccessTokenMock.mockReset();
  });

  it("passes both trailing-slash and non-slash audience forms to the verifier", async () => {
    // The fix: validAudiences in oauthProvider mints tokens for either
    // `${baseUrl}` or `${baseUrl}/`, so the verifier must accept the same
    // set. Regression: previously only `${baseUrl}/` was accepted, causing
    // 401s when clients normalised the resource indicator without the slash.
    verifyAccessTokenMock.mockResolvedValueOnce({ sub: "user-1", scope: "openid" });
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    const req = new Request("https://example.com/api/mcp", {
      headers: { authorization: "Bearer token-abc" },
    });

    await withOAuthAuth(req, handler);

    expect(verifyAccessTokenMock).toHaveBeenCalledTimes(1);
    const [, opts] = verifyAccessTokenMock.mock.calls[0] as [
      string,
      { verifyOptions: { audience: unknown; issuer: string } },
    ];
    expect(opts.verifyOptions.audience).toEqual(["https://example.com", "https://example.com/"]);
    expect(opts.verifyOptions.issuer).toBe("https://example.com/api/auth");
  });

  it("returns 401 with invalid_token when verification fails", async () => {
    verifyAccessTokenMock.mockRejectedValueOnce(new Error("bad signature"));
    const handler = vi.fn();
    const req = new Request("https://example.com/api/mcp", {
      headers: { authorization: "Bearer bad-token" },
    });

    const res = await withOAuthAuth(req, handler);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const handler = vi.fn();
    const req = new Request("https://example.com/api/mcp");

    const res = await withOAuthAuth(req, handler);

    expect(res.status).toBe(401);
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
