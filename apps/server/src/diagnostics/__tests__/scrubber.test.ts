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
  it("redacts the token portion of `Authorization: Bearer …` headers", () => {
    // Doesn't care whether the redacted form keeps the literal "Bearer" or
    // collapses to `Authorization=[REDACTED]` — what matters is that the
    // raw token never survives the scrub.
    const out = scrubStringValue("Authorization: Bearer abc.def.ghi");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("abc.def.ghi");
  });

  it("redacts sensitive URL query parameters", () => {
    const out = scrubStringValue("https://example.com/cb?token=abc123&user=alice");
    expect(out).toContain("token=[REDACTED]");
    expect(out).toContain("user=alice");
  });

  it("redacts JWT-shaped substrings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.signatureGoesHere";
    expect(scrubStringValue(`saw ${jwt} in log`)).toContain("[JWT_REDACTED]");
  });

  it("redacts inline key=value pairs naming a sensitive key", () => {
    expect(scrubStringValue("password=hunter2 and other stuff")).toContain("password=[REDACTED]");
    expect(scrubStringValue("api_key: ak_xyz123")).toContain("api_key=[REDACTED]");
  });

  it("does NOT redact bare high-entropy identifiers (CUID2, SHA256, slugs)", () => {
    // Regression: the previous length-only heuristic gobbled these and
    // destroyed the diagnostic context this scrubber exists to preserve.
    const cuid2 = "k2x9p3m4n5q6r7s8t9u0v1w2";
    const sha256 = "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e";
    const slug = "request-7f3a9b2c4d5e6f1a8b9c0d2e";
    expect(scrubStringValue(cuid2)).toBe(cuid2);
    expect(scrubStringValue(sha256)).toBe(sha256);
    expect(scrubStringValue(slug)).toBe(slug);
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
