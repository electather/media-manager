// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Suspense } from "react";
import type { ConnectionListItem, PrimaryConnectionRow } from "@nama/shared/connections";

const fetchersMock = vi.hoisted(() => ({
  fetchConnections: vi.fn(),
  fetchPrimaryConnections: vi.fn(),
  fetchSetPrimaryConnection: vi.fn(),
  fetchClearPrimaryConnection: vi.fn(),
}));
vi.mock("../lib/fetchers", () => fetchersMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { PrimaryProvidersCard } from "../components/primary-providers-card";
import { settingsConnectionsKeys } from "../lib/query-keys";
import { SettingsConnectionsApiError } from "../lib/types";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function withClient(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <Suspense fallback={<div data-testid="suspense" />}>{children}</Suspense>
      </QueryClientProvider>
    );
  };
}

function makeConnection(overrides: Partial<ConnectionListItem> = {}): ConnectionListItem {
  return {
    id: overrides.id ?? "c1",
    pluginId: overrides.pluginId ?? "tmdb",
    status: overrides.status ?? "connected",
    enabled: overrides.enabled ?? true,
    isDefault: false,
    displayName: overrides.displayName ?? null,
    tokenExpiresAt: null,
    lastVerifiedAt: null,
    errorMessage: null,
    createdAt: 0,
    updatedAt: 0,
    displayFields: [],
    plugin: {
      id: overrides.pluginId ?? "tmdb",
      name: overrides.pluginId ?? "TMDB",
      version: "1.0.0",
      description: "",
      authKind: "none",
      poolable: false,
      userScopedCapabilities: [{ id: "metadata", version: "v1" }],
      globalScopedCapabilities: [],
      userConfigSchema: null,
      credentialsSchema: null,
      adminSharedAvailable: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  // base-ui Select calls scrollIntoView on focused options; happy-dom omits it.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
  for (const m of Object.values(fetchersMock)) m.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  fetchersMock.fetchPrimaryConnections.mockResolvedValue([]);
  fetchersMock.fetchSetPrimaryConnection.mockResolvedValue(undefined);
  fetchersMock.fetchClearPrimaryConnection.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("<PrimaryProvidersCard /> — visibility", () => {
  it("renders nothing when only 1 eligible connection exists per row", async () => {
    fetchersMock.fetchConnections.mockResolvedValue([makeConnection({ id: "c1" })]);
    render(<PrimaryProvidersCard />, { wrapper: withClient(makeClient()) });
    // Card has data-testid="primary-providers-card"; expect it not to mount.
    await waitFor(() => expect(fetchersMock.fetchPrimaryConnections).toHaveBeenCalled());
    expect(screen.queryByTestId("primary-providers-card")).toBeNull();
  });

  it("renders the card with both rows when ≥2 eligible exist for metadata@v1", async () => {
    fetchersMock.fetchConnections.mockResolvedValue([
      makeConnection({ id: "c1", pluginId: "tmdb", displayName: "TMDB main" }),
      makeConnection({ id: "c2", pluginId: "tvdb", displayName: "TVDB" }),
    ]);
    render(<PrimaryProvidersCard />, { wrapper: withClient(makeClient()) });
    expect(await screen.findByTestId("primary-providers-card")).toBeTruthy();
    // Two media-type rows render → two combobox triggers.
    const combos = await screen.findAllByRole("combobox");
    expect(combos.length).toBe(2);
  });

  it("hides disabled or disconnected connections from the dropdown options", async () => {
    // Eligible = {enabled, status: connected, advertises capability}.
    // c-disabled and c-error should be excluded; the row should not render
    // because only 1 eligible remains.
    fetchersMock.fetchConnections.mockResolvedValue([
      makeConnection({ id: "c-ok", pluginId: "tmdb" }),
      makeConnection({ id: "c-disabled", pluginId: "tvdb", enabled: false }),
      makeConnection({ id: "c-error", pluginId: "trakt", status: "error" }),
    ]);
    render(<PrimaryProvidersCard />, { wrapper: withClient(makeClient()) });
    await waitFor(() => expect(fetchersMock.fetchPrimaryConnections).toHaveBeenCalled());
    expect(screen.queryByTestId("primary-providers-card")).toBeNull();
  });
});

describe("<PrimaryProvidersCard /> — interactions", () => {
  it("fires POST /primary with capabilityKey + mediaType + connectionId on select", async () => {
    fetchersMock.fetchConnections.mockResolvedValue([
      makeConnection({ id: "c1", pluginId: "tmdb", displayName: "TMDB main" }),
      makeConnection({ id: "c2", pluginId: "tvdb", displayName: "TVDB" }),
    ]);
    const user = userEvent.setup();
    render(<PrimaryProvidersCard />, { wrapper: withClient(makeClient()) });

    const triggers = await screen.findAllByRole("combobox");
    await user.click(triggers[0]!); // Movies row.
    const tvdbOption = await screen.findByRole("option", { name: "TVDB" });
    await user.click(tvdbOption);

    await waitFor(() => expect(fetchersMock.fetchSetPrimaryConnection).toHaveBeenCalled());
    expect(fetchersMock.fetchSetPrimaryConnection.mock.calls[0]?.[0]).toEqual({
      capabilityKey: "metadata@v1",
      mediaType: "movie",
      connectionId: "c2",
    });
  });

  it("fires DELETE /primary when the user picks Auto", async () => {
    fetchersMock.fetchConnections.mockResolvedValue([
      makeConnection({ id: "c1", pluginId: "tmdb", displayName: "TMDB main" }),
      makeConnection({ id: "c2", pluginId: "tvdb", displayName: "TVDB" }),
    ]);
    fetchersMock.fetchPrimaryConnections.mockResolvedValue([
      { capabilityKey: "metadata@v1", mediaType: "movie", connectionId: "c2" },
    ] satisfies PrimaryConnectionRow[]);
    const user = userEvent.setup();
    render(<PrimaryProvidersCard />, { wrapper: withClient(makeClient()) });

    const triggers = await screen.findAllByRole("combobox");
    // Sanity: the row's pinned value drives the trigger's textual content;
    // the user sees the TVDB label and is about to flip back to Auto.
    await waitFor(() => expect(triggers[0]!.textContent).toContain("TVDB"));
    await user.click(triggers[0]!);
    const autoOption = await screen.findByRole("option", { name: "Auto (provider order)" });
    await user.click(autoOption);

    await waitFor(() => expect(fetchersMock.fetchClearPrimaryConnection).toHaveBeenCalled());
    expect(fetchersMock.fetchClearPrimaryConnection.mock.calls[0]?.[0]).toEqual({
      capabilityKey: "metadata@v1",
      mediaType: "movie",
    });
  });

  it("rolls back the optimistic update on a 5xx and surfaces a toast", async () => {
    fetchersMock.fetchConnections.mockResolvedValue([
      makeConnection({ id: "c1", pluginId: "tmdb", displayName: "TMDB main" }),
      makeConnection({ id: "c2", pluginId: "tvdb", displayName: "TVDB" }),
    ]);
    fetchersMock.fetchPrimaryConnections.mockResolvedValue([]);
    fetchersMock.fetchSetPrimaryConnection.mockRejectedValue(new Error("boom"));

    const qc = makeClient();
    const user = userEvent.setup();
    render(<PrimaryProvidersCard />, { wrapper: withClient(qc) });

    const triggers = await screen.findAllByRole("combobox");
    await user.click(triggers[0]!);
    const tvdbOption = await screen.findByRole("option", { name: "TVDB" });
    await user.click(tvdbOption);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    // Cache must roll back to the empty array — useOptimisticArrayMutation
    // restores the previous snapshot on error.
    const final = qc.getQueryData<PrimaryConnectionRow[]>(settingsConnectionsKeys.primary());
    expect(final).toEqual([]);
  });

  it("surfaces a differentiated toast and refetches primaries + connections on connection.not_found", async () => {
    fetchersMock.fetchConnections.mockResolvedValue([
      makeConnection({ id: "c1", pluginId: "tmdb", displayName: "TMDB main" }),
      makeConnection({ id: "c2", pluginId: "tvdb", displayName: "TVDB" }),
    ]);
    fetchersMock.fetchPrimaryConnections.mockResolvedValue([]);
    fetchersMock.fetchSetPrimaryConnection.mockRejectedValue(
      new SettingsConnectionsApiError(404, { code: "connection.not_found", message: "x" }),
    );

    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const user = userEvent.setup();
    render(<PrimaryProvidersCard />, { wrapper: withClient(qc) });

    const triggers = await screen.findAllByRole("combobox");
    await user.click(triggers[0]!);
    const tvdbOption = await screen.findByRole("option", { name: "TVDB" });
    await user.click(tvdbOption);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Connection not found"));
    // Spec §6: refetch both primaries + connections so a deleted row clears.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsConnectionsKeys.primary() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsConnectionsKeys.connections() });
  });

  it("surfaces a differentiated toast and refetches primaries on connection.capability_unsupported", async () => {
    fetchersMock.fetchConnections.mockResolvedValue([
      makeConnection({ id: "c1", pluginId: "tmdb", displayName: "TMDB main" }),
      makeConnection({ id: "c2", pluginId: "tvdb", displayName: "TVDB" }),
    ]);
    fetchersMock.fetchPrimaryConnections.mockResolvedValue([]);
    fetchersMock.fetchSetPrimaryConnection.mockRejectedValue(
      new SettingsConnectionsApiError(422, {
        code: "connection.capability_unsupported",
        message: "x",
      }),
    );

    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const user = userEvent.setup();
    render(<PrimaryProvidersCard />, { wrapper: withClient(qc) });

    const triggers = await screen.findAllByRole("combobox");
    await user.click(triggers[0]!);
    const tvdbOption = await screen.findByRole("option", { name: "TVDB" });
    await user.click(tvdbOption);

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("That provider doesn't support metadata"),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsConnectionsKeys.primary() });
    // Connections list is unchanged on capability-unsupported — no refetch.
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: settingsConnectionsKeys.connections(),
    });
  });

  it("renders the 'Auto (was X)' option when the pinned connection became ineligible", async () => {
    // Connection c-stale is the previously-pinned row but is currently
    // disabled, so it is NOT in the eligible list. The dropdown must keep
    // the user-visible memory of the prior selection via the "Auto (was X)"
    // label so the state isn't silently swept away.
    fetchersMock.fetchConnections.mockResolvedValue([
      makeConnection({ id: "c1", pluginId: "tmdb", displayName: "TMDB main" }),
      makeConnection({ id: "c2", pluginId: "tvdb", displayName: "TVDB" }),
      makeConnection({
        id: "c-stale",
        pluginId: "trakt",
        displayName: "Stale Trakt",
        enabled: false,
      }),
    ]);
    fetchersMock.fetchPrimaryConnections.mockResolvedValue([
      { capabilityKey: "metadata@v1", mediaType: "movie", connectionId: "c-stale" },
    ] satisfies PrimaryConnectionRow[]);

    const user = userEvent.setup();
    render(<PrimaryProvidersCard />, { wrapper: withClient(makeClient()) });

    const triggers = await screen.findAllByRole("combobox");
    await user.click(triggers[0]!);
    // Auto-was-X label exposes the connection's displayName.
    expect(await screen.findByRole("option", { name: /Stale Trakt/ })).toBeTruthy();
  });
});
