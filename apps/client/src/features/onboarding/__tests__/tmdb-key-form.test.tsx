// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Stub only the network seams so the real hooks, state machine, and conditional
// render path under test all run as-written. saveTmdbKey is stubbed alongside
// testTmdbKey to prevent any accidental real call if the component wiring changes,
// even though no test here exercises the save flow.
const fetchers = vi.hoisted(() => ({
  testTmdbKey: vi.fn(),
  saveTmdbKey: vi.fn(),
}));
vi.mock("../lib/fetchers", () => ({
  testTmdbKey: fetchers.testTmdbKey,
  saveTmdbKey: fetchers.saveTmdbKey,
}));

import { TmdbKeyForm } from "../components/steps/tmdb-key-form";

function renderForm(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TmdbKeyForm />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fetchers.testTmdbKey.mockReset();
  fetchers.saveTmdbKey.mockReset();
});

describe("TmdbKeyForm — TestResult branches", () => {
  // Exercises the branch in <TestResult> that renders result.message when the
  // probe returns { ok: false, message: "..." }. That path is distinct from the
  // generic onboarding_tmdb_test_failed copy shown when the mutation itself
  // errors (network failure, etc.), and no existing test targets it.
  it("shows the server-supplied message when the probe returns { ok: false, message }", async () => {
    const user = userEvent.setup();
    fetchers.testTmdbKey.mockResolvedValue({ ok: false, message: "Expired API key" });

    renderForm();

    await user.type(screen.getByRole("textbox"), "some-api-key");
    await user.click(screen.getByRole("button", { name: /test key/i }));

    // The component must render the server message verbatim, not fall back to
    // the generic "That key did not work" copy from onboarding_tmdb_test_failed.
    expect(await screen.findByText("Expired API key")).not.toBeNull();
  });

  it("shows the generic failure copy when the probe returns { ok: false } with no message", async () => {
    const user = userEvent.setup();
    fetchers.testTmdbKey.mockResolvedValue({ ok: false });

    renderForm();

    await user.type(screen.getByRole("textbox"), "some-api-key");
    await user.click(screen.getByRole("button", { name: /test key/i }));

    // Without a server message the component falls back to the generic locale
    // copy — this verifies the fallback branch of the same ternary.
    expect(await screen.findByText(/that key did not work/i)).not.toBeNull();
  });

  it("shows success copy when the probe returns { ok: true }", async () => {
    const user = userEvent.setup();
    fetchers.testTmdbKey.mockResolvedValue({ ok: true });

    renderForm();

    await user.type(screen.getByRole("textbox"), "some-api-key");
    await user.click(screen.getByRole("button", { name: /test key/i }));

    // A successful probe must surface the ok copy so the admin knows the key
    // is valid before committing it with the Save button.
    expect(await screen.findByText(/the key works/i)).not.toBeNull();
  });

  it("shows the generic failure copy when the mutation itself rejects", async () => {
    const user = userEvent.setup();
    fetchers.testTmdbKey.mockRejectedValue(new Error("Network error"));

    renderForm();

    await user.type(screen.getByRole("textbox"), "some-api-key");
    await user.click(screen.getByRole("button", { name: /test key/i }));

    // A rejected mutation (network error, server crash) sets isError=true on the
    // hook. The component must not go blank — it falls back to the generic copy.
    expect(await screen.findByText(/that key did not work/i)).not.toBeNull();
  });
});
