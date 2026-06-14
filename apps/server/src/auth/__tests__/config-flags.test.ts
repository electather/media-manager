import { describe, expect, it, vi } from "vite-plus/test";

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

// The auth instance only constructs its options; no DB query runs at import
// time, so a stub client is enough to satisfy the drizzle adapter.
vi.mock("../../db/client", () => ({
  getDb: () => ({}),
}));

import { auth } from "../internal/config";

// These two flags are the server-side load-bearing guarantees of the
// first-install design. They are config-object assertions because the values
// are what Better Auth enforces at runtime, and asserting them directly locks
// in the security contract without booting the full HTTP stack.
describe("auth config security flags", () => {
  // WHY: with public sign-up open, an attacker could POST /api/auth/sign-up/email
  // on a fresh install, create a role-less user, and flip needsBootstrap to
  // false — a denial-of-setup that locks the operator out of /bootstrap. The
  // only sanctioned first-user path must be the token-gated bootstrap claim.
  it("disables public sign-up (disableSignUp === true)", () => {
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  // WHY: hasOnboarded gates the TMDB-required onboarding wizard. With the
  // default input:true, a client could set hasOnboarded:true through Better
  // Auth's create/update input and trivially bypass the gate. input:false makes
  // the flag flip only via the server-authoritative markUserOnboarded path.
  it("marks hasOnboarded as non-input (input === false)", () => {
    const field = auth.options.user?.additionalFields?.hasOnboarded;
    expect(field?.input).toBe(false);
  });
});
