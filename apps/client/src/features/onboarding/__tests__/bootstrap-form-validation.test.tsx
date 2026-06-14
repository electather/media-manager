// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// This test runtime-verifies the shared-zod integration: the form validates each
// field against `bootstrapClaimSchema.shape.<field>` (the exact schema the server
// uses), so a failing field must surface its localized error AND block the claim.
// We mock only the network-touching seams — the claim fetcher, the auth client,
// and navigation — plus the auth shell (whose poster-grid background does live
// data fetching unrelated to validation). The form and its zod validators stay
// real, which is what proves the per-field schema wiring works at runtime.
const fetchers = vi.hoisted(() => ({
  claimBootstrap: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("../lib/fetchers", () => fetchers);

const auth = vi.hoisted(() => ({
  signIn: { email: vi.fn().mockResolvedValue({ data: {} }) },
}));
vi.mock("@/shared/lib/auth", () => ({ authClient: auth }));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  };
});

// The real `AuthShell` renders the poster-grid background, which fetches live
// trending data. Stub it to a pass-through wrapper and keep the real
// `PasswordField` so the password input under test is genuine.
vi.mock("@/features/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    AuthShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  };
});

import { BootstrapPage } from "../components/bootstrap-page";

// The form gives every input a stable id matched to its label's `htmlFor`, so
// selecting by id is unambiguous even though the password toggle button shares
// the word "password" in its accessible name.
function input(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`missing input #${id}`);
  return el;
}
const nameInput = () => input("bootstrap-name");
const emailInput = () => input("bootstrap-email");
const passwordInput = () => input("bootstrap-password");
const tokenInput = () => input("bootstrap-token");

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BootstrapPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fetchers.claimBootstrap.mockClear();
  auth.signIn.email.mockClear();
  navigateMock.mockReset();
});

describe("BootstrapForm — shared-schema validation", () => {
  beforeEach(() => {
    fetchers.claimBootstrap.mockResolvedValue({ ok: true });
  });

  it("surfaces localized per-field errors for invalid input and never calls the claim mutation", async () => {
    const user = userEvent.setup();
    renderPage();

    // Invalid in every field: empty name, malformed email, too-short password,
    // empty token — each violates exactly one `bootstrapClaimSchema` rule. The
    // password field carries a show/hide toggle whose aria-label also contains
    // "password", so we select the actual inputs by id to stay unambiguous.
    // The name and token fields are touched-and-blurred so their `onBlur` zod
    // validators fire on the empty value, surfacing each field's own error
    // (each `FieldError` reads only its own field's meta).
    await user.click(nameInput());
    await user.click(tokenInput());
    await user.type(emailInput(), "not-an-email");
    await user.type(passwordInput(), "short");
    await user.click(screen.getByRole("button", { name: /create administrator/i }));

    // The schema-driven, localized messages render — proving each per-field zod
    // validator fires (not a single generic submit error). Standard-schema
    // validation is async, so each message is awaited rather than read
    // synchronously.
    expect(await screen.findByText(/enter a valid email/i)).toBeTruthy();
    expect(await screen.findByText(/at least 8 characters/i)).toBeTruthy();
    expect(await screen.findByText(/name is required/i)).toBeTruthy();
    expect(await screen.findByText(/setup token is required/i)).toBeTruthy();

    // Validation must gate the network: an invalid form does not hit the server.
    expect(fetchers.claimBootstrap).not.toHaveBeenCalled();
    expect(auth.signIn.email).not.toHaveBeenCalled();
  });

  it("passes validation and submits the claim when every field is valid", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(nameInput(), "Ada Lovelace");
    await user.type(emailInput(), "ada@example.com");
    await user.type(passwordInput(), "correct-horse");
    await user.type(tokenInput(), "the-one-time-token");
    await user.click(screen.getByRole("button", { name: /create administrator/i }));

    // Valid input clears the schema gate and reaches the claim fetcher with the
    // exact form values, then establishes the session for the new admin. React
    // Query passes a context object as a second argument to the mutation fn, so
    // we assert against the first argument (the claim body) only.
    await waitFor(() => expect(fetchers.claimBootstrap).toHaveBeenCalled());
    expect(fetchers.claimBootstrap.mock.calls[0]?.[0]).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse",
      token: "the-one-time-token",
    });
    await waitFor(() =>
      expect(auth.signIn.email).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "correct-horse",
      }),
    );
  });
});
