// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { JSONSchema } from "@nama/shared";

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  patch: vi.fn(),
  persistedTest: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/shared/lib/api", () => ({
  api: {
    plugins: {
      ":id": {
        "shared-credentials": {
          $get: (args: unknown) => apiMock.list(args),
          ":credId": {
            $patch: (args: unknown) => apiMock.patch(args),
            test: {
              $post: (args: unknown) => apiMock.persistedTest(args),
            },
          },
        },
      },
    },
  },
}));

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
  apiMock.list.mockReset();
  apiMock.patch.mockReset();
  apiMock.persistedTest.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();

  // Return a fresh Response per call — a Response body can only be read once,
  // and the optimistic toggle path may refetch the list.
  apiMock.list.mockImplementation(() => Promise.resolve(jsonResponse({ entries: [ENTRY] })));
});

afterEach(() => cleanup());

describe("SharedCredentialsSection enable toggle", () => {
  it("flips the switch optimistically and keeps it after success", async () => {
    // Mirror the server: once the patch lands, the list reflects the new state
    // so the post-settle refetch agrees with the optimistic value.
    let enabled = true;
    apiMock.list.mockImplementation(() =>
      Promise.resolve(jsonResponse({ entries: [{ ...ENTRY, enabled }] })),
    );
    apiMock.patch.mockImplementation((args: { json: { enabled: boolean } }) => {
      enabled = args.json.enabled;
      return Promise.resolve(jsonResponse({ ...ENTRY, enabled }));
    });
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
    expect(apiMock.patch).toHaveBeenCalledWith({
      param: { id: "tmdb", credId: "cred-1" },
      json: { enabled: false },
    });
    // `onSettled` asks the parent to refetch the plugin row counts.
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("rolls the switch back to its prior state when the toggle request fails", async () => {
    apiMock.patch.mockResolvedValue(jsonResponse({ message: "nope" }, 500));
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
    apiMock.persistedTest.mockResolvedValue(jsonResponse({ ok: false }));
    const user = userEvent.setup();
    renderSection();

    const row = (await screen.findByText("Primary key")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^test$/i }));

    expect(await within(row).findByText("Test failed")).toBeTruthy();
  });
});
