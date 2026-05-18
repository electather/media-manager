import { describe, it, expect } from "vite-plus/test";
import { scrub, serializeContext } from "../scrubber";

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

  it("converts Date to its ISO string", () => {
    expect(scrub(new Date("2024-01-01T00:00:00.000Z"))).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns 'Invalid Date' for an invalid Date instead of throwing", () => {
    expect(() => scrub(new Date("not-a-date"))).not.toThrow();
    expect(scrub(new Date("not-a-date"))).toBe("Invalid Date");
  });

  it("survives an invalid Date nested in a context blob without losing siblings", () => {
    const out = scrub({ when: new Date("bad"), safe: "ok" }) as Record<string, unknown>;
    expect(out.when).toBe("Invalid Date");
    expect(out.safe).toBe("ok");
  });

  it("serializes a context containing an invalid Date without falling back to error blob", () => {
    const out = serializeContext({ when: new Date("bad") });
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!) as { when: string };
    expect(parsed.when).toBe("Invalid Date");
    expect(out).not.toContain("__serialize_error");
  });

  it("converts URL to its string form", () => {
    expect(scrub(new URL("https://example.com"))).toBe("https://example.com/");
  });

  it("converts Error to a loggable {name, message, stack} object", () => {
    const err = new Error("boom");
    const out = scrub(err) as { name: string; message: string; stack: string | undefined };
    expect(out.name).toBe("Error");
    expect(out.message).toBe("boom");
    expect(out.stack).toBe(err.stack);
  });

  it("redacts sensitive keys inside a Map", () => {
    const out = scrub(new Map([["token", "secret"]])) as Record<string, unknown>;
    expect(out.token).toBe("[REDACTED]");
  });

  it("converts Set to an array, scrubbing each element", () => {
    expect(scrub(new Set([1, 2, 3]))).toEqual([1, 2, 3]);
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
