// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { isRedirect } from "@tanstack/react-router";

// The `_authenticated` guard calls `authClient.getSession()` directly, so the
// session is the seam these tests drive. The root and bootstrap guards instead
// read public config through the `queryClient.ensureQueryData` they are handed,
// so those are exercised with a fabricated context object — no auth mock needed.
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/shared/lib/auth", () => ({ authClient: auth }));

import { Route as RootRoute } from "@/routes/__root";
import { Route as AuthenticatedRoute } from "@/routes/_authenticated/route";
import { Route as BootstrapRoute } from "@/routes/bootstrap";

// beforeLoad throws redirect on guard; destination at err.options.to. Test encodes guard rules (not just smoke-test).
async function runGuard(
  beforeLoad: ((args: never) => unknown) | undefined,
  args: unknown,
): Promise<string | null> {
  if (!beforeLoad) throw new Error("route is missing a beforeLoad guard");
  try {
    await (beforeLoad as (a: unknown) => unknown)(args);
    return null;
  } catch (err) {
    if (isRedirect(err)) {
      // `redirect()` stores its destination under `options.to`.
      return (err as { options: { to?: string } }).options.to ?? null;
    }
    throw err;
  }
}

/** Builds a fake route context whose `ensureQueryData` resolves the given public config. */
function contextResolving(cfg: { needsBootstrap: boolean }) {
  return {
    queryClient: {
      ensureQueryData: async () => ({
        ...cfg,
        emailEnabled: false,
        mcpEndpointUrl: "",
        mcpScopes: [] as string[],
      }),
    },
  };
}

/** Builds a fake route context whose `ensureQueryData` rejects, simulating a backend outage. */
function contextRejecting() {
  return {
    queryClient: {
      ensureQueryData: async () => {
        throw new Error("backend unreachable");
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("root guard — fresh-install bootstrap funnel", () => {
  it("redirects to /bootstrap on a fresh install away from /bootstrap", async () => {
    const target = await runGuard(RootRoute.options.beforeLoad, {
      context: contextResolving({ needsBootstrap: true }),
      location: { pathname: "/" },
    });
    // Zero-user install must funnel every other route to the public setup page.
    expect(target).toBe("/bootstrap");
  });

  it("does not redirect when already on /bootstrap (breaks the redirect loop)", async () => {
    const target = await runGuard(RootRoute.options.beforeLoad, {
      context: contextResolving({ needsBootstrap: true }),
      location: { pathname: "/bootstrap" },
    });
    // Without this exemption the guard would redirect /bootstrap → /bootstrap forever.
    expect(target).toBeNull();
  });

  it("does not redirect once the server has users (needsBootstrap false)", async () => {
    const target = await runGuard(RootRoute.options.beforeLoad, {
      context: contextResolving({ needsBootstrap: false }),
      location: { pathname: "/" },
    });
    // A set-up server must let normal routing proceed.
    expect(target).toBeNull();
  });

  it("fails open when public config is unreachable (does not throw)", async () => {
    // A backend outage must not blank the entire app: the guard swallows the
    // error and lets the route render rather than redirecting on null config.
    await expect(
      runGuard(RootRoute.options.beforeLoad, {
        context: contextRejecting(),
        location: { pathname: "/" },
      }),
    ).resolves.toBeNull();
  });
});

describe("_authenticated guard — session and onboarding funnel", () => {
  it("redirects to /auth/login when there is no session", async () => {
    auth.getSession.mockResolvedValue({ data: null });
    const target = await runGuard(AuthenticatedRoute.options.beforeLoad, {
      location: { pathname: "/dash", href: "/dash" },
    });
    // Protected routes must never render without a session.
    expect(target).toBe("/auth/login");
  });

  it("redirects an un-onboarded user to /setup (pre-existing user backfilled to hasOnboarded=false)", async () => {
    // This is the design's "pre-existing user backfilled to false is sent to
    // /setup" case: a user created before the migration reads hasOnboarded ===
    // false and must be funneled into the wizard, proving the upgrade behavior
    // change is intentional and observable.
    auth.getSession.mockResolvedValue({ data: { user: { hasOnboarded: false } } });
    const target = await runGuard(AuthenticatedRoute.options.beforeLoad, {
      location: { pathname: "/dash", href: "/dash" },
    });
    expect(target).toBe("/setup");
  });

  it("does not redirect an un-onboarded user already on /setup (the wizard route is exempt)", async () => {
    auth.getSession.mockResolvedValue({ data: { user: { hasOnboarded: false } } });
    const target = await runGuard(AuthenticatedRoute.options.beforeLoad, {
      location: { pathname: "/setup", href: "/setup" },
    });
    // Exempting /setup is what lets the wizard actually render instead of looping.
    expect(target).toBeNull();
  });

  it("does not redirect an onboarded user", async () => {
    auth.getSession.mockResolvedValue({ data: { user: { hasOnboarded: true } } });
    const target = await runGuard(AuthenticatedRoute.options.beforeLoad, {
      location: { pathname: "/dash", href: "/dash" },
    });
    // A finished user must reach the app, not be sent back to onboarding.
    expect(target).toBeNull();
  });
});

describe("bootstrap guard — already-set-up redirect", () => {
  it("redirects to /auth/login when the server is already set up", async () => {
    const target = await runGuard(BootstrapRoute.options.beforeLoad, {
      context: contextResolving({ needsBootstrap: false }),
    });
    // There is nothing to bootstrap once users exist; send the operator to sign in.
    expect(target).toBe("/auth/login");
  });

  it("does not redirect while the server still needs bootstrapping", async () => {
    const target = await runGuard(BootstrapRoute.options.beforeLoad, {
      context: contextResolving({ needsBootstrap: true }),
    });
    expect(target).toBeNull();
  });

  it("fails open when public config is unreachable (shows the bootstrap page)", async () => {
    // The claim endpoint is server-authoritative, so showing the page on a null
    // config is safe; crashing the only setup path on a transient outage is not.
    await expect(
      runGuard(BootstrapRoute.options.beforeLoad, { context: contextRejecting() }),
    ).resolves.toBeNull();
  });
});
