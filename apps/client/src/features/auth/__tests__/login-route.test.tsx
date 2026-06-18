// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// Stable stub for the localized generic social-sign-in error message. The route
// must only ever reflect this fixed string — never URL-supplied text — so we
// don't need the paraglide runtime here.
const ERROR_MESSAGE = "Social sign-in failed. Please try again.";

vi.mock("@/paraglide/messages", () => ({
  m: { auth_social_signin_error: () => ERROR_MESSAGE },
}));

// Capture the LoginRoute component via createFileRoute's options so we can
// render it without standing up a full TanStack router. useSearch is a per-test
// controllable mock; useNavigate returns a stable spy so the route's effect dep
// array stays stable across the post-mount re-render.
const searchMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const routeRef = vi.hoisted(() => ({
  component: null as null | (() => ReactNode),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => ReactNode }) => {
    routeRef.component = opts.component;
    return {
      useSearch: searchMock,
      useNavigate: () => navigateMock,
    };
  },
}));

// LoginForm has its own test file; stub it so this test isolates the route's
// snapshot-then-clean logic and asserts the prop it received.
vi.mock("@/features/auth", () => ({
  LoginForm: ({ oauthError }: { oauthError: string | undefined }) => (
    <div data-testid="login-form">{oauthError ?? ""}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

import "@/routes/auth/login";

function LoginRoute() {
  if (!routeRef.component) throw new Error("LoginRoute was not captured by createFileRoute");
  const C = routeRef.component;
  return <C />;
}

describe("LoginRoute — OAuth error snapshot and URL cleanup", () => {
  // Pin #1 from review: the banner must stay visible after mount when ?error is
  // present. The useState initializer snapshots the localized message before the
  // effect runs the replace navigation, so a future refactor that lifts state
  // into the form (or derives directly from useSearch) cannot silently drop it.
  it("surfaces the OAuth error banner when ?error is present", () => {
    searchMock.mockReturnValue({ error: "invalid_request", redirect: undefined });
    render(<LoginRoute />);

    expect(screen.getByTestId("login-form").textContent).toBe(ERROR_MESSAGE);
  });

  // Pin #2 from review: ?error is stripped from the URL via a replace
  // navigation (no new history entry) so bookmarks and back/forward cannot
  // re-trigger the banner. The search updater drops only the error key and
  // preserves other search params like the redirect target.
  it("clears ?error from the URL via a replace navigation", async () => {
    searchMock.mockReturnValue({ error: "invalid_request", redirect: undefined });
    render(<LoginRoute />);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledTimes(1));

    const arg = navigateMock.mock.calls[0]![0] as {
      replace: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(arg.replace).toBe(true);
    expect(arg.search({ redirect: "/library", error: "invalid_request" })).toStrictEqual({
      redirect: "/library",
      error: undefined,
    });
  });

  // The negative case: without ?error the route must not touch the URL and must
  // not raise the banner — otherwise normal logins would be flagged as failures.
  it("does not navigate or surface a banner when ?error is absent", () => {
    searchMock.mockReturnValue({ error: undefined, redirect: undefined });
    render(<LoginRoute />);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("login-form").textContent).toBe("");
  });
});
