// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MediaRequest, RequestTarget } from "@nama/shared/media";
import type { Season } from "../lib/types";

const apiMock = vi.hoisted(() => ({
  targets: vi.fn(),
  create: vi.fn(),
  history: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../lib/fetchers", () => ({ requestsApi: apiMock }));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toastMock) }));

import { RequestableSeasons } from "../components/requestable-seasons";

const TARGETS: RequestTarget[] = [
  {
    serviceId: "conn-1:5",
    pluginId: "seerr",
    label: "Sonarr Main",
    exposesProfiles: false,
    defaultProfileId: null,
    profiles: [],
  },
];

const seasons: Season[] = [1, 2, 3].map((n) => ({
  number: n,
  episodeCount: 2,
  counts: { unavailable: 2 },
  episodes: [
    {
      id: `s${n}e1`,
      episode: 1,
      title: "Pilot",
      airDate: "2024-01-01",
      runtime: 42,
      status: "unavailable",
    },
    {
      id: `s${n}e2`,
      episode: 2,
      title: "Aftershock",
      airDate: "2024-01-08",
      runtime: 42,
      status: "unavailable",
    },
  ],
}));

function withClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  apiMock.targets.mockReset();
  apiMock.create.mockReset();
  apiMock.history.mockReset();
  apiMock.cancel.mockReset();
  apiMock.history.mockResolvedValue({ items: [] });
  toastMock.success.mockReset();
  toastMock.info.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => cleanup());

describe("RequestableSeasons", () => {
  it("submits a single season with seasons:[n]", async () => {
    apiMock.targets.mockResolvedValue(TARGETS);
    apiMock.create.mockResolvedValueOnce({ requestId: "1" });

    const Wrapper = withClient();
    render(
      <Wrapper>
        <RequestableSeasons itemId="tv:123" itemTitle="Show" seasons={seasons} />
      </Wrapper>,
    );

    const triggers = screen.getAllByRole("button", { name: /request missing/i });
    fireEvent.click(triggers[0]!);
    await waitFor(() => screen.getByRole("button", { name: /request season/i }));
    fireEvent.click(screen.getByRole("button", { name: /request season/i }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalledTimes(1));
    expect(apiMock.create).toHaveBeenCalledWith({
      tmdbId: "123",
      mediaType: "tv",
      serviceId: "conn-1:5",
      profileId: null,
      seasons: [1],
    });
  });

  it("bulk submit posts a single request with every requestable season", async () => {
    apiMock.targets.mockResolvedValue(TARGETS);
    apiMock.create.mockResolvedValueOnce({ requestId: "9" });

    const Wrapper = withClient();
    render(
      <Wrapper>
        <RequestableSeasons itemId="tv:123" itemTitle="Show" seasons={seasons} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: /request all/i }));
    await waitFor(() => screen.getByRole("button", { name: /request 3 seasons/i }));
    fireEvent.click(screen.getByRole("button", { name: /request 3 seasons/i }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalledTimes(1));
    expect(apiMock.create).toHaveBeenCalledWith({
      tmdbId: "123",
      mediaType: "tv",
      serviceId: "conn-1:5",
      profileId: null,
      seasons: [1, 2, 3],
    });
  });

  it("rolls back the optimistic season override on mutation failure", async () => {
    apiMock.targets.mockResolvedValue(TARGETS);
    apiMock.create.mockRejectedValueOnce(new Error("boom"));

    const Wrapper = withClient();
    render(
      <Wrapper>
        <RequestableSeasons itemId="tv:123" itemTitle="Show" seasons={seasons} />
      </Wrapper>,
    );

    const triggers = screen.getAllByRole("button", { name: /request missing/i });
    fireEvent.click(triggers[0]!);
    await waitFor(() => screen.getByRole("button", { name: /request season/i }));
    fireEvent.click(screen.getByRole("button", { name: /request season/i }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/awaiting approval/i)).toBeNull());
  });

  it("renders a disabled 'no plugin configured' affordance when pluginConfigured is false", async () => {
    apiMock.targets.mockResolvedValue([]);

    const Wrapper = withClient();
    render(
      <Wrapper>
        <RequestableSeasons
          itemId="tv:123"
          itemTitle="Show"
          seasons={seasons}
          pluginConfigured={false}
        />
      </Wrapper>,
    );

    const disabledButtons = await waitFor(() =>
      screen.getAllByRole("button", { name: /no plugin configured/i }),
    );
    expect(disabledButtons.length).toBe(seasons.length);
    for (const btn of disabledButtons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /request missing/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /request all/i })).toBeNull();
  });

  it("derives per-season pending only for seasons listed in the matching row", async () => {
    const row: MediaRequest = {
      id: "r-7",
      tmdbId: "123",
      type: "tv",
      title: "Show",
      status: "pending",
      seasons: [2],
      targetLabel: "Sonarr Main",
      profileLabel: null,
      createdAt: "2026-05-09T00:00:00Z",
    };
    apiMock.history.mockResolvedValue({ items: [row] });
    apiMock.targets.mockResolvedValue(TARGETS);

    const Wrapper = withClient();
    render(
      <Wrapper>
        <RequestableSeasons itemId="tv:123" itemTitle="Show" seasons={seasons} />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getAllByText(/awaiting approval/i).length).toBeGreaterThanOrEqual(1),
    );
    // Seasons 1 and 3 keep their request affordance.
    expect(
      screen.getAllByRole("button", { name: /request missing/i }).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
