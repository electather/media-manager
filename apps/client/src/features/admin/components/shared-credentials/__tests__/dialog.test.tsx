// @vitest-environment happy-dom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { JSONSchema } from "@ent-mcp/shared";

const apiMock = vi.hoisted(() => ({
  create: vi.fn(),
  ephemeralTest: vi.fn(),
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
          $post: (args: unknown) => apiMock.create(args),
          "test-ephemeral": {
            $post: (args: unknown) => apiMock.ephemeralTest(args),
          },
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

import { SharedCredentialDialog } from "../dialog";

type ExistingCredential = NonNullable<ComponentProps<typeof SharedCredentialDialog>["existing"]>;

const API_KEY_SCHEMA = {
  type: "object",
  required: ["apiKey"],
  properties: {
    apiKey: {
      type: "string",
      title: "API key",
      "x-secret": true,
    },
  },
} satisfies JSONSchema;

const EXISTING_CREDENTIAL: ExistingCredential = {
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

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <SharedCredentialDialog
        open
        onOpenChange={onOpenChange}
        pluginId="tmdb"
        pluginName="TMDB"
        schema={API_KEY_SCHEMA}
        existing={EXISTING_CREDENTIAL}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );

  return { onOpenChange, onSaved };
}

beforeEach(() => {
  apiMock.create.mockReset();
  apiMock.ephemeralTest.mockReset();
  apiMock.patch.mockReset();
  apiMock.persistedTest.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();

  apiMock.ephemeralTest.mockResolvedValue(jsonResponse({ ok: true, message: "Candidate works." }));
  apiMock.persistedTest.mockResolvedValue(jsonResponse({ ok: true, message: "Stored works." }));
  apiMock.patch.mockResolvedValue(jsonResponse({ ok: true }));
});

afterEach(() => cleanup());

describe("SharedCredentialDialog edit testing", () => {
  it("tests the persisted credential before saving a label-only edit", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog();

    const label = screen.getByDisplayValue("Primary key");
    await user.clear(label);
    await user.type(label, "Renamed key");
    await user.click(screen.getByRole("button", { name: /test & save/i }));

    await waitFor(() => expect(apiMock.persistedTest).toHaveBeenCalledTimes(1));
    expect(apiMock.persistedTest).toHaveBeenCalledWith({
      param: { id: "tmdb", credId: "cred-1" },
    });
    expect(apiMock.ephemeralTest).not.toHaveBeenCalled();
    expect(apiMock.patch).toHaveBeenCalledWith({
      param: { id: "tmdb", credId: "cred-1" },
      json: { label: "Renamed key" },
    });
    expect(onSaved).toHaveBeenCalledWith(false);
  });

  it("tests the persisted credential before saving an enabled-only edit", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog();

    await user.click(screen.getByRole("switch", { name: /disable credential/i }));
    await user.click(screen.getByRole("button", { name: /test & save/i }));

    await waitFor(() => expect(apiMock.persistedTest).toHaveBeenCalledTimes(1));
    expect(apiMock.persistedTest).toHaveBeenCalledWith({
      param: { id: "tmdb", credId: "cred-1" },
    });
    expect(apiMock.ephemeralTest).not.toHaveBeenCalled();
    expect(apiMock.patch).toHaveBeenCalledWith({
      param: { id: "tmdb", credId: "cred-1" },
      json: { enabled: false },
    });
    expect(onSaved).toHaveBeenCalledWith(true);
  });

  it("surfaces a persisted-test failure and skips save", async () => {
    apiMock.persistedTest.mockResolvedValueOnce(
      jsonResponse({ ok: false, message: "Stored credential is invalid." }),
    );
    const user = userEvent.setup();
    const { onSaved } = renderDialog();

    const label = screen.getByDisplayValue("Primary key");
    await user.clear(label);
    await user.type(label, "Renamed key");
    await user.click(screen.getByRole("button", { name: /test & save/i }));

    await waitFor(() => expect(apiMock.persistedTest).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Stored credential is invalid.")).toBeTruthy();
    expect(apiMock.patch).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("tests unsaved credential values with the ephemeral endpoint before saving", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog();

    await user.type(screen.getByPlaceholderText("Leave blank to keep current value"), "new-key");
    await user.click(screen.getByRole("button", { name: /test & save/i }));

    await waitFor(() => expect(apiMock.ephemeralTest).toHaveBeenCalledTimes(1));
    expect(apiMock.ephemeralTest).toHaveBeenCalledWith({
      param: { id: "tmdb" },
      json: { value: { apiKey: "new-key" } },
    });
    expect(apiMock.persistedTest).not.toHaveBeenCalled();
    expect(apiMock.patch).toHaveBeenCalledWith({
      param: { id: "tmdb", credId: "cred-1" },
      json: { value: { apiKey: "new-key" } },
    });
    expect(onSaved).toHaveBeenCalledWith(false);
  });
});
