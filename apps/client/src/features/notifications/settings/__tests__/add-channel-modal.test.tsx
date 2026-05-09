// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchersMock = vi.hoisted(() => ({
  fetchPlugins: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
  api: {
    connections: {
      available: {
        $get: vi.fn(),
      },
    },
  },
}));

vi.mock("../../shared/fetchers", () => fetchersMock);
vi.mock("@/shared/lib/api", () => apiMock);
vi.mock("@/features/connections", () => ({
  // Stub so the test doesn't pull ConnectionModal's full surface area; we just
  // assert that picking a plugin transitions to it with the right plugin id.
  ConnectionModal: ({ open, plugin }: { open: boolean; plugin: { id: string } | null }) =>
    open && plugin ? <div data-testid="connection-modal">{plugin.id}</div> : null,
}));

import { AddChannelModal } from "../add-channel-modal";

function renderWithClient(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const plexSummary = {
  id: "plex",
  name: "Plex",
  version: "1.0.0",
  description: "Self-hosted media server.",
  authKind: "form" as const,
  userScopedCapabilities: [],
  globalScopedCapabilities: [],
  userConfigSchema: null,
  adminSharedAvailable: false,
};

const traktSummary = {
  id: "trakt",
  name: "Trakt",
  version: "1.0.0",
  description: "Watch history sync.",
  authKind: "oauth_device" as const,
  userScopedCapabilities: [],
  globalScopedCapabilities: [],
  userConfigSchema: null,
  adminSharedAvailable: false,
};

beforeEach(() => {
  fetchersMock.fetchPlugins.mockResolvedValue({
    plugins: [{ id: "plex", name: "Plex", description: "", authKind: "form", supportsKinds: [] }],
  });
  apiMock.api.connections.available.$get.mockResolvedValue({
    ok: true,
    json: async () => ({ plugins: [plexSummary, traktSummary] }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddChannelModal", () => {
  it("filters available plugins to notification-capable ones", async () => {
    renderWithClient(<AddChannelModal open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(fetchersMock.fetchPlugins).toHaveBeenCalled();
      expect(apiMock.api.connections.available.$get).toHaveBeenCalled();
    });

    expect(await screen.findByText("Plex")).toBeTruthy();
    expect(screen.queryByText("Trakt")).toBeNull();
  });

  it("opens ConnectionModal for the selected plugin", async () => {
    const user = userEvent.setup();
    renderWithClient(<AddChannelModal open onOpenChange={() => {}} />);

    const plexButton = await screen.findByText("Plex");
    await user.click(plexButton);

    await waitFor(() => {
      expect(screen.getByTestId("connection-modal")).toBeTruthy();
    });
    expect(screen.getByTestId("connection-modal").textContent).toBe("plex");
  });

  it("renders empty state when no plugins overlap", async () => {
    fetchersMock.fetchPlugins.mockResolvedValue({ plugins: [] });
    renderWithClient(<AddChannelModal open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(fetchersMock.fetchPlugins).toHaveBeenCalled();
    });

    // The picker keeps Plex out of the eligible set when notif plugins is empty.
    await waitFor(() => {
      expect(screen.queryByText("Plex")).toBeNull();
    });
  });

  it("does not fetch while closed", () => {
    renderWithClient(<AddChannelModal open={false} onOpenChange={() => {}} />);
    expect(fetchersMock.fetchPlugins).not.toHaveBeenCalled();
    expect(apiMock.api.connections.available.$get).not.toHaveBeenCalled();
  });
});
