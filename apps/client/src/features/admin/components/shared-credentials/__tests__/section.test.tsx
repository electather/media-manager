// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { JSONSchema } from "@nama/shared";

// Mock the feature's fetchers (not the transport) per the frontend-feature
// architecture convention — assert the component↔fetcher contract directly.
const fetchersMock = vi.hoisted(() => ({
  fetchSharedCredentials: vi.fn(),
  fetchPatchSharedCredential: vi.fn(),
  fetchTestSharedCredentialPersisted: vi.fn(),
  fetchDeleteSharedCredential: vi.fn(),
}));
vi.mock("@/features/admin/lib/fetchers", () => fetchersMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { SharedCredentialsSection } from "../section";

const API_KEY_SCHEMA = {
  type: "object",
  required: ["apiKey"],
  properties: {
    apiKey: { type: "string", title: "API key", "x-secret": true },
  },
} satisfies JSONSchema;

const ENTRY = {
  id: "cred-1",
  label: "Primary key",
  enabled: true,
  lastExhaustedAt: null,
  retryAfter: null,
  createdAt: 0,
  updatedAt: 0,
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const onChanged = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <SharedCredentialsSection
        pluginId="tmdb"
        pluginName="TMDB"
        schema={API_KEY_SCHEMA}
        poolable
        capabilityHint="global-only"
        onChanged={onChanged}
      />
    </QueryClientProvider>,
  );

  return { onChanged };
}

beforeEach(() => {
  fetchersMock.fetchSharedCredentials.mockReset();
  fetchersMock.fetchPatchSharedCredential.mockReset();
  fetchersMock.fetchTestSharedCredentialPersisted.mockReset();
  fetchersMock.fetchDeleteSharedCredential.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();

  fetchersMock.fetchSharedCredentials.mockResolvedValue({ entries: [{ ...ENTRY }] });
});

afterEach(() => cleanup());

describe("SharedCredentialsSection enable toggle", () => {
  it("flips the switch optimistically and keeps it after success", async () => {
    // Mirror the server: once the patch lands, the list reflects the new state
    // so the post-settle refetch agrees with the optimistic value.
    let enabled = true;
    fetchersMock.fetchSharedCredentials.mockImplementation(() =>
      Promise.resolve({ entries: [{ ...ENTRY, enabled }] }),
    );
    fetchersMock.fetchPatchSharedCredential.mockImplementation(
      (input: { patch: { enabled: boolean } }) => {
        enabled = input.patch.enabled;
        return Promise.resolve({ ...ENTRY, enabled });
      },
    );
    const user = userEvent.setup();
    const { onChanged } = renderSection();

    const toggle = await screen.findByRole("switch", { name: /disable credential/i });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await user.click(toggle);

    // Optimistic patch flips the cache, so the switch moves before/independent
    // of the round-trip; it must stay off once the server confirms.
    await waitFor(() =>
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"),
    );
    expect(fetchersMock.fetchPatchSharedCredential).toHaveBeenCalledWith({
      pluginId: "tmdb",
      credId: "cred-1",
      patch: { enabled: false },
    });
    // `onSettled` asks the parent to refetch the plugin row counts.
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("rolls the switch back to its prior state when the toggle request fails", async () => {
    fetchersMock.fetchPatchSharedCredential.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderSection();

    const toggle = await screen.findByRole("switch", { name: /disable credential/i });
    await user.click(toggle);

    // Snapshot restore returns the switch to `enabled: true` after the error.
    await waitFor(() =>
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"),
    );
    expect(toastMock.error).toHaveBeenCalled();
  });
});

describe("SharedCredentialsSection row test", () => {
  it("shows 'Test failed' when a failed test returns no message", async () => {
    fetchersMock.fetchTestSharedCredentialPersisted.mockResolvedValue({ ok: false });
    const user = userEvent.setup();
    renderSection();

    const row = (await screen.findByText("Primary key")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^test$/i }));

    expect(await within(row).findByText("Test failed")).toBeTruthy();
  });
});
