import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../internal/config", () => ({ auth: { handler: vi.fn() } }));

import { scrubOAuthBody } from "../internal/oauth-handler";

describe("scrubOAuthBody", () => {
  it("redacts OAuth-specific sensitive keys", () => {
    const out = scrubOAuthBody({
      code: "auth_code_value",
      code_verifier: "pkce_verifier_value",
    }) as Record<string, unknown>;
    expect(out.code).toBe("[REDACTED]");
    expect(out.code_verifier).toBe("[REDACTED]");
  });

  it("redacts token and secret families via the diagnostics scrubber", () => {
    const out = scrubOAuthBody({
      access_token: "at",
      refresh_token: "rt",
      id_token: "it",
      client_secret: "cs",
    }) as Record<string, unknown>;
    expect(out.access_token).toBe("[REDACTED]");
    expect(out.refresh_token).toBe("[REDACTED]");
    expect(out.id_token).toBe("[REDACTED]");
    expect(out.client_secret).toBe("[REDACTED]");
  });

  it("preserves non-sensitive OAuth fields", () => {
    const out = scrubOAuthBody({
      grant_type: "authorization_code",
      scope: "openid profile",
      redirect_uri: "https://app.example.com/cb",
      client_id: "client_abc",
      response_type: "code",
      expires_in: 3600,
    }) as Record<string, unknown>;
    expect(out.grant_type).toBe("authorization_code");
    expect(out.scope).toBe("openid profile");
    expect(out.redirect_uri).toBe("https://app.example.com/cb");
    expect(out.client_id).toBe("client_abc");
    expect(out.response_type).toBe("code");
    expect(out.expires_in).toBe(3600);
  });

  it("over-redacts token_type harmlessly — `token` is a sensitive-key fragment", () => {
    // `token_type` (e.g. "Bearer") is technically not sensitive, but the
    // diagnostics scrubber redacts any key containing `token`. Accepted
    // tradeoff for reusing the shared scrubber instead of forking patterns.
    const out = scrubOAuthBody({ token_type: "Bearer" }) as Record<string, unknown>;
    expect(out.token_type).toBe("[REDACTED]");
  });

  it("passes null and non-object bodies through scrub", () => {
    expect(scrubOAuthBody(null)).toBe(null);
    expect(scrubOAuthBody(undefined)).toBe(undefined);
    expect(scrubOAuthBody("opaque")).toBe("opaque");
  });

  it("handles array bodies without leaking values", () => {
    const out = scrubOAuthBody([{ access_token: "x" }]) as Array<Record<string, unknown>>;
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]?.access_token).toBe("[REDACTED]");
  });
});
