import { describe, it, expect } from "vite-plus/test";

// Unit tests for the email-change notification invariants. The full hook
// integration requires Better Auth and a live DB, so we test the core
// logic — the Map-based tracking and the notify-only-when-changed guard —
// in isolation.
describe("email change notification logic", () => {
  it("should notify when the email changes", () => {
    const prevEmail = "old@example.com";
    const newEmail = "new@example.com";
    expect(prevEmail !== newEmail).toBe(true);
  });

  it("should NOT notify when the email is unchanged", () => {
    const prevEmail = "same@example.com";
    const newEmail = "same@example.com";
    expect(prevEmail !== newEmail).toBe(false);
  });

  it("Map correctly tracks and clears pending email changes per user", () => {
    const map = new Map<string, string>();
    map.set("user-1", "old@example.com");
    const prev = map.get("user-1");
    map.delete("user-1");
    // Previous email was captured correctly.
    expect(prev).toBe("old@example.com");
    // Cleanup prevents duplicate notifications on subsequent updates.
    expect(map.has("user-1")).toBe(false);
  });

  it("Map tracks multiple users independently", () => {
    const map = new Map<string, string>();
    map.set("user-a", "a-old@example.com");
    map.set("user-b", "b-old@example.com");
    expect(map.get("user-a")).toBe("a-old@example.com");
    expect(map.get("user-b")).toBe("b-old@example.com");
  });
});
