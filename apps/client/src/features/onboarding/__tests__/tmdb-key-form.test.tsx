// @vitest-environment happy-dom
import { afterEach, describe, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Stub only the network seams so the real hooks, state machine, and conditional
// render path under test all run as-written.
const fetchers = vi.hoisted(() => ({
  testTmdbKey: vi.fn(),
  saveTmdbKey: vi.fn(),
}));
vi.mock("../lib/fetchers", async (orig) => ({
  ...((await orig()) as object),
  testTmdbKey: fetchers.testTmdbKey,
  saveTmdbKey: fetchers.saveTmdbKey,
}));

import { TmdbKeyForm } from "../components/steps/tmdb-key-form";

function renderForm(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TmdbKeyForm />
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  cleanup();
  fetchers.testTmdbKey.mockReset();
  fetchers.saveTmdbKey.mockReset();
});

describe("TmdbKeyForm — TestResult message path", () => {
  // This test specifically exercises the branch in <TestResult> that renders
  // result.message when the probe returns { ok: false, message: "..." }.
  // That path is distinct from the generic `onboarding_tmdb_test_failed` copy
  // shown when the mutation itself errors (network failure, etc.), and no
  // existing test targets it.
  it("shows the server-supplied message when the probe returns { ok: false, message }", async () => {
    const user = userEvent.setup();
    fetchers.testTmdbKey.mockResolvedValue({ ok: false, message: "Expired API key" });

    renderForm();

    await user.type(screen.getByRole("textbox"), "some-api-key");
    await user.click(screen.getByRole("button", { name: /test key/i }));

    // The component must render the server message verbatim, not fall back to
    // the generic "That key did not work" copy from onboarding_tmdb_test_failed.
    // `getByText` throws if absent, so it is the assertion on its own.
    await waitFor(() => screen.getByText("Expired API key"));
  });

  it("shows the generic failure copy when the probe returns { ok: false } with no message", async () => {
    const user = userEvent.setup();
    fetchers.testTmdbKey.mockResolvedValue({ ok: false });

    renderForm();

    await user.type(screen.getByRole("textbox"), "some-api-key");
    await user.click(screen.getByRole("button", { name: /test key/i }));

    // Without a server message the component falls back to the generic locale
    // copy — this verifies the fallback branch of the same ternary. `getByText`
    // throws if absent, so it is the assertion on its own.
    await waitFor(() => screen.getByText(/that key did not work/i));
  });
});
