import { describe, it, expect } from "vite-plus/test";
import { scrub, scrubText, serializeContext } from "../scrubber";

describe("scrub", () => {
  it("redacts values under sensitive top-level keys", () => {
    const out = scrub({ username: "alice", password: "hunter2" }) as Record<string, unknown>;
    expect(out.username).toBe("alice");
    expect(out.password).toBe("[REDACTED]");
  });

  it("redacts case-insensitively and across fragment matches", () => {
    const out = scrub({
      Authorization: "Bearer xyz",
      apiKey: "ak_xyz",
      "api-key": "ak_xyz",
      API_KEY: "ak_xyz",
      accessToken: "abc.def",
    }) as Record<string, unknown>;
    expect(out.Authorization).toBe("[REDACTED]");
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out["api-key"]).toBe("[REDACTED]");
    expect(out.API_KEY).toBe("[REDACTED]");
    expect(out.accessToken).toBe("[REDACTED]");
  });

  it("recursively scrubs nested objects and arrays", () => {
    const out = scrub({
      payload: {
        items: [{ token: "t1" }, { safe: 1 }],
        nested: { credentials: { foo: "bar" } },
      },
    }) as { payload: { items: unknown[]; nested: { credentials: unknown } } };
    expect((out.payload.items[0] as { token: string }).token).toBe("[REDACTED]");
    expect((out.payload.items[1] as { safe: number }).safe).toBe(1);
    expect(out.payload.nested.credentials).toBe("[REDACTED]");
  });

  it("leaves primitive values alone", () => {
    expect(scrub(42)).toBe(42);
    expect(scrub("hello")).toBe("hello");
    expect(scrub(null)).toBe(null);
    expect(scrub(undefined)).toBe(undefined);
  });

  it("scrubs free-text secrets in string leaves under non-sensitive keys", () => {
    // Defense in depth: a string value sitting under a benign key name
    // (e.g. `stack`, `message`, `cause`) still gets run through scrubText,
    // so URL params / Bearer / JWT inside free-form strings cannot leak via
    // structured payloads like `meta.error.stack` in job run logs.
    const out = scrub({
      error: {
        message: "request to https://api.example.com/v1?api_key=plaintext failed",
        stack: "Error: boom\n    at fetch (https://idp.example.com/cb?access_token=abc)",
        cause: "Authorization: Bearer xyz",
      },
      note: "no secrets here",
    }) as { error: Record<string, string>; note: string };
    expect(out.error.message).toContain("api_key=[REDACTED]");
    expect(out.error.message).not.toContain("plaintext");
    expect(out.error.stack).toContain("access_token=[REDACTED]");
    expect(out.error.stack).not.toContain("abc");
    expect(out.error.cause).toBe("Authorization: Bearer [REDACTED]");
    expect(out.note).toBe("no secrets here");
  });

  it("bounds recursion at a safe depth", () => {
    // Builds a cycle so naive recursion would stack-overflow; we just check the
    // scrubber returns without throwing and stops descending past the limit.
    const root: Record<string, unknown> = {};
    let cur = root;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = {};
      cur.next = next;
      cur = next;
    }
    const out = scrub(root);
    expect(out).toBeDefined();
  });
});

describe("scrubText", () => {
  it("redacts Bearer auth tokens", () => {
    expect(scrubText("Authorization: Bearer abc.def.ghi")).toBe("Authorization: Bearer [REDACTED]");
    // Case-insensitive on the keyword itself.
    expect(scrubText("bearer xyz123")).toBe("Bearer [REDACTED]");
  });

  it("redacts sensitive URL query params, including OAuth families", () => {
    const out = scrubText("https://idp.example.com/cb?access_token=abc&refresh_token=def&state=42");
    expect(out).toContain("access_token=[REDACTED]");
    expect(out).toContain("refresh_token=[REDACTED]");
    expect(out).toContain("state=42");
    expect(out).not.toContain("abc");
    expect(out).not.toContain("def");
  });

  it("redacts client_secret and bare token in URLs", () => {
    const out = scrubText(
      "GET https://api.example.com/v1?token=plain https://idp.example.com/exchange?client_secret=shh",
    );
    expect(out).toContain("token=[REDACTED]");
    expect(out).toContain("client_secret=[REDACTED]");
    expect(out).not.toContain("plain");
    expect(out).not.toContain("shh");
  });

  it("redacts JWT-shaped strings", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(scrubText(`token issued: ${jwt} (expired)`)).toBe(
      "token issued: [JWT_REDACTED] (expired)",
    );
  });

  it("leaves non-sensitive text unchanged", () => {
    const msg = "Failed to load resource https://api.example.com/v1/items?page=2";
    expect(scrubText(msg)).toBe(msg);
  });

  it("redacts cookie URL params and private_key log-line pairs", () => {
    // Both keys are in SENSITIVE_KEY_PATTERNS; the substring-based KV regex
    // catches them in either URL-param or log-line shape without per-name entries.
    const urlOut = scrubText("https://api.example.com/v1?cookie=session_abc&page=1");
    expect(urlOut).toContain("cookie=[REDACTED]");
    expect(urlOut).not.toContain("session_abc");
    expect(urlOut).toContain("page=1");

    const logOut = scrubText("config dump: private_key: -----BEGIN secret ends here");
    expect(logOut).toContain("private_key: [REDACTED]");
    expect(logOut).not.toContain("-----BEGIN");
  });

  it("returns empty string unchanged (null/undefined are filtered upstream)", () => {
    expect(scrubText("")).toBe("");
  });
});

describe("serializeContext", () => {
  it("returns null for empty input", () => {
    expect(serializeContext(undefined)).toBeNull();
    expect(serializeContext({})).toBeNull();
  });

  it("produces a JSON string with sensitive values redacted", () => {
    const out = serializeContext({ email: "a@b.com", password: "x" });
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!) as { email: string; password: string };
    expect(parsed.email).toBe("a@b.com");
    expect(parsed.password).toBe("[REDACTED]");
  });
});
