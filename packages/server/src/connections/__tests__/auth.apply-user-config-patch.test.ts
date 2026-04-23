import { describe, it, expect, vi } from "vite-plus/test";

// Stub env so importing `../auth` (which transitively touches the db layer)
// doesn't require real secrets. Matches the pattern in helpers.test.ts.
vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const { applyUserConfigPatch } = await import("../auth");

describe("applyUserConfigPatch", () => {
  it("returns the original userConfig unchanged when patch is undefined", () => {
    const cfg = { host: "https://example.com", userId: "u1" };
    expect(applyUserConfigPatch(cfg, undefined)).toBe(cfg);
  });

  it("returns the original userConfig unchanged when patch is empty", () => {
    const cfg = { host: "https://example.com" };
    expect(applyUserConfigPatch(cfg, {})).toBe(cfg);
  });

  it("merges non-null patch values over the base", () => {
    expect(applyUserConfigPatch({ host: "a", userId: "old" }, { userId: "new" })).toEqual({
      host: "a",
      userId: "new",
    });
  });

  it("treats a null patch value as a delete (strips the key from the merged result)", () => {
    // This is the hook that lets plugins move a submitted secret (e.g.
    // Jellyfin's password) out of userConfig and into the encrypted
    // credentials blob — the plugin returns `{ password: null }` on the
    // patch, and the host drops the key from the persisted userConfig.
    const result = applyUserConfigPatch(
      { host: "a", username: "alice", password: "plaintext" },
      { userId: "u1", password: null },
    );
    expect(result).toEqual({ host: "a", username: "alice", userId: "u1" });
    expect(Object.keys(result as Record<string, unknown>)).not.toContain("password");
  });

  it("does not mutate the input userConfig", () => {
    const cfg = { host: "a", password: "secret" };
    applyUserConfigPatch(cfg, { password: null });
    expect(cfg).toEqual({ host: "a", password: "secret" });
  });

  it("builds a fresh object when the base userConfig is null and the patch has entries", () => {
    // Used by redirect / device auth where no userConfig is submitted with
    // the initial request but the plugin returns patch keys to persist.
    const result = applyUserConfigPatch(null, { machineId: "abc" });
    expect(result).toEqual({ machineId: "abc" });
  });
});
