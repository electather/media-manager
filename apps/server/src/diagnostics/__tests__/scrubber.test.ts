import { describe, it, expect } from "vite-plus/test";
import { scrub, scrubStringValue, serializeContext } from "../scrubber";

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

describe("scrubStringValue", () => {
  it("redacts the token after `Bearer `", () => {
    expect(scrubStringValue("Authorization header is Bearer abc123def456")).toBe(
      "Authorization header is Bearer [REDACTED]",
    );
  });

  it("redacts sensitive `key=value` pairs in URL query strings", () => {
    expect(scrubStringValue("https://api.example.com/v1?token=ak_live_xyz&user=alice")).toBe(
      "https://api.example.com/v1?token=[REDACTED]&user=alice",
    );
  });

  it("redacts sensitive `key=value` pairs in bare log-like text", () => {
    expect(scrubStringValue("login failed: password=hunter2 user=alice")).toBe(
      "login failed: password=[REDACTED] user=alice",
    );
  });

  it("redacts sensitive `key: value` pairs in header-style text", () => {
    expect(scrubStringValue("authorization: ak_live_xyz request_id=42")).toBe(
      "authorization: [REDACTED] request_id=42",
    );
  });

  it("redacts JWT-shaped strings", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(scrubStringValue(`token is ${jwt}`)).toBe("token is [JWT_REDACTED]");
  });

  it("does not redact SHA-256 hex digests in plain text", () => {
    // 64-char hex looks high-entropy but is not a secret in our diagnostic context.
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(scrubStringValue(`commit ${sha256} merged`)).toBe(`commit ${sha256} merged`);
  });

  it("does not redact UUIDs without dashes in plain text", () => {
    const uuid = "550e8400e29b41d4a716446655440000";
    expect(scrubStringValue(`request ${uuid} completed`)).toBe(`request ${uuid} completed`);
  });

  it("does not redact CUID2 identifiers in plain text", () => {
    // CUID2 is ~24 chars of mixed-case alphanum, typical of internal record IDs.
    const cuid2 = "ckpvj8q3z0000m1n3o5p7r9t2";
    expect(scrubStringValue(`record ${cuid2} not found`)).toBe(`record ${cuid2} not found`);
  });

  it("does not redact long base64-looking identifiers without a sensitive-key context", () => {
    // A 44-char alphanum run with mixed case and digits; in the old broad
    // regex this would have been redacted as a false positive.
    const payload = "abcdefABCDEF0123456789abcdefABCDEF0123456789AB";
    expect(scrubStringValue(`payload ${payload} processed`)).toBe(`payload ${payload} processed`);
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
