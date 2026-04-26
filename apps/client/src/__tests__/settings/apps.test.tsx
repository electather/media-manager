// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthorizedApp } from "@ent-mcp/shared/users";

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    me: {
      apps: Object.assign(
        {
          $get: () => apiMock.list(),
        },
        {
          ":clientId": {
            revoke: { $post: (args: { param: { clientId: string } }) => apiMock.revoke(args) },
          },
        },
      ),
    },
  },
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { AppsList } from "@/routes/_authenticated/_settings/settings/apps";

beforeEach(() => {
  apiMock.list.mockReset();
  apiMock.revoke.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.info.mockReset();
});

afterEach(() => cleanup());

function renderWithClient(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const apps: AuthorizedApp[] = [
  {
    clientId: "claude",
    name: "Claude Desktop",
    scopes: ["read", "write"],
    connectedAt: Date.now() - 86_400_000,
    lastUsedAt: Date.now() - 60_000,
    ownedByUser: false,
  },
  {
    clientId: "cursor",
    name: "Cursor",
    scopes: ["read"],
    connectedAt: Date.now() - 7 * 86_400_000,
    lastUsedAt: null,
    ownedByUser: true,
  },
];

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AppsList", () => {
  it("renders the authorized-app rows with revoke wired through the dialog", async () => {
    apiMock.list
      .mockResolvedValueOnce(jsonResponse(apps))
      .mockResolvedValue(jsonResponse([apps[1]]));
    apiMock.revoke.mockResolvedValue(jsonResponse({ ok: true, apps: [apps[1]] }));

    const user = userEvent.setup();
    renderWithClient(<AppsList />);

    await waitFor(() => {
      expect(screen.getByTestId("authorized-app-claude")).toBeTruthy();
      expect(screen.getByTestId("authorized-app-cursor")).toBeTruthy();
    });

    await user.click(screen.getByTestId("revoke-claude"));
    await user.click(await screen.findByTestId("confirm-revoke-app"));

    await waitFor(() =>
      expect(apiMock.revoke).toHaveBeenCalledWith({ param: { clientId: "claude" } }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("authorized-app-claude")).toBeNull());
  });

  it("renders the empty state without a setup-guides button", async () => {
    apiMock.list.mockResolvedValue(jsonResponse([]));

    renderWithClient(<AppsList />);

    expect(await screen.findByText(/no authorized applications/i)).toBeTruthy();
    expect(screen.queryByText(/setup guides/i)).toBeNull();
  });

  it("toasts 'Already revoked' on a 404 from the server", async () => {
    apiMock.list.mockResolvedValue(jsonResponse(apps));
    apiMock.revoke.mockResolvedValue(jsonResponse({ code: "me.app_not_authorized" }, 404));

    const user = userEvent.setup();
    renderWithClient(<AppsList />);

    await user.click(await screen.findByTestId("revoke-claude"));
    await user.click(await screen.findByTestId("confirm-revoke-app"));

    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Already revoked."));
  });

  it("renders a retry surface when the list query errors", async () => {
    apiMock.list.mockResolvedValue(jsonResponse({ message: "boom" }, 500));

    renderWithClient(<AppsList />);

    expect(await screen.findByText(/could not load authorized applications/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
