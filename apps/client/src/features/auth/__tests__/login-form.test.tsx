// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";

// Paraglide stub: stable English strings so we can assert text without the runtime.
vi.mock("@/paraglide/messages", () => ({
  m: {
    auth_sign_in_to_continue: () => "Sign in to continue",
    auth_email: () => "Email",
    auth_password: () => "Password",
    auth_stay_signed_in: () => "Stay signed in",
    auth_forgot_password_question: () => "Forgot password?",
    auth_or_continue_with: () => "or continue with",
    auth_no_account_question: () => "Don't have an account?",
    auth_sign_up: () => "Sign up",
    auth_show_password: () => "Show",
    auth_hide_password: () => "Hide",
    auth_show_password_aria: () => "Show password",
    auth_hide_password_aria: () => "Hide password",
    auth_login_submit: () => "Sign in",
    auth_social_signin_error: () => "Social sign-in failed. Please try again.",
  },
}));

// Router Link/social buttons aren't under test here; stub them to plain nodes so
// the form renders without a router or the social sign-in mutation.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../components/social-buttons", () => ({
  SocialButtons: () => <div data-testid="social-buttons" />,
}));

// The login mutation drives the busy flag; we control its state per test.
const useLoginMock = vi.hoisted(() => vi.fn());
vi.mock("../hooks/use-login", () => ({ useLogin: useLoginMock }));

import { LoginForm, buildErrorCallbackURL, isFormBusy } from "../components/login-form";

function setMutation(overrides: Partial<{ isPending: boolean; isSuccess: boolean }>) {
  useLoginMock.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null,
    status: "idle",
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("isFormBusy", () => {
  // The race fix: success must count as busy so the form stays locked through
  // the async navigate() that follows a successful login. If this regresses,
  // the gap between success and unmount reopens the duplicate-submit window.
  it("locks the form once the mutation has succeeded", () => {
    expect(isFormBusy(false, false, true)).toBe(true);
  });

  it("locks the form while submitting or pending", () => {
    expect(isFormBusy(true, false, false)).toBe(true);
    expect(isFormBusy(false, true, false)).toBe(true);
  });

  it("leaves the form interactive when idle", () => {
    expect(isFormBusy(false, false, false)).toBe(false);
  });
});

describe("buildErrorCallbackURL", () => {
  it("encodes the redirect target so the OAuth round-trip returns to it", () => {
    expect(buildErrorCallbackURL("/library?q=a b")).toBe(
      "/auth/login?redirect=%2Flibrary%3Fq%3Da%20b",
    );
  });

  it("falls back to the bare login route when there is no redirect", () => {
    expect(buildErrorCallbackURL(undefined)).toBe("/auth/login");
  });
});

describe("LoginForm", () => {
  it("disables inputs and submit while the mutation is succeeding", () => {
    setMutation({ isSuccess: true });
    render(<LoginForm redirectTo={undefined} oauthError={undefined} />);

    expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("keeps inputs interactive when idle", () => {
    setMutation({});
    render(<LoginForm redirectTo={undefined} oauthError={undefined} />);

    expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("surfaces the OAuth error message when one is supplied", () => {
    setMutation({});
    render(
      <LoginForm redirectTo={undefined} oauthError="Social sign-in failed. Please try again." />,
    );

    expect(screen.getByText("Social sign-in failed. Please try again.")).not.toBeNull();
  });

  it("renders no OAuth error banner when none is supplied", () => {
    setMutation({});
    render(<LoginForm redirectTo={undefined} oauthError={undefined} />);

    expect(screen.queryByText("Social sign-in failed. Please try again.")).toBeNull();
  });
});
