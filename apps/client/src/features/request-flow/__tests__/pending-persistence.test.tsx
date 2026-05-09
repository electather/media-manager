// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MediaRequest } from "@ent-mcp/shared/media";
import type { Season } from "../lib/types";

const apiMock = vi.hoisted(() => ({
  targets: vi.fn(),
  create: vi.fn(),
  history: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../api/client", () => ({ requestsApi: apiMock }));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toastMock) }));

import { MovieRequestAction } from "../components/movie-request-action";
import { RequestableSeasons } from "../components/requestable-seasons";

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
  toastMock.success.mockReset();
  toastMock.info.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => cleanup());

describe("pending persistence (reload simulation)", () => {
  it("MovieRequestAction renders pending purely from server-derived overlay", async () => {
    const row: MediaRequest = {
      id: "r-1",
      tmdbId: "550",
      type: "movie",
      title: "Fight Club",
      status: "pending",
      seasons: [],
      targetLabel: "Radarr Main",
      profileLabel: "1080p",
      createdAt: "2026-05-09T00:00:00Z",
    };
    apiMock.history.mockResolvedValue({ items: [row] });

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    await waitFor(() => screen.getByText(/awaiting approval/i));
    expect(apiMock.create).not.toHaveBeenCalled();
  });

  it("RequestableSeasons renders only matching season as pending", async () => {
    const row: MediaRequest = {
      id: "r-2",
      tmdbId: "123",
      type: "tv",
      title: "Show",
      status: "pending",
      seasons: [3],
      targetLabel: "Sonarr Main",
      profileLabel: null,
      createdAt: "2026-05-09T00:00:00Z",
    };
    apiMock.history.mockResolvedValue({ items: [row] });
    apiMock.targets.mockResolvedValue([]);

    const seasons: Season[] = [1, 2, 3].map((n) => ({
      number: n,
      episodeCount: 1,
      counts: { unavailable: 1 },
      episodes: [
        {
          id: `s${n}e1`,
          episode: 1,
          title: "Pilot",
          airDate: "2024-01-01",
          runtime: 42,
          status: "unavailable",
        },
      ],
    }));

    const Wrapper = withClient();
    render(
      <Wrapper>
        <RequestableSeasons itemId="tv:123" itemTitle="Show" seasons={seasons} />
      </Wrapper>,
    );

    await waitFor(() => screen.getByText(/awaiting approval/i));
    // Exactly one season-row pending.
    expect(screen.getAllByText(/awaiting approval/i).length).toBe(1);
  });
});
