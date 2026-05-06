// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, type ReactNode } from "react";
import type { SeasonAvailabilityResponse, SeasonInfo } from "@ent-mcp/shared/home";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { SeasonsList } from "../seasons-list";

afterEach(() => cleanup());
beforeEach(() => vi.restoreAllMocks());

function withClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ErrorBoundary fallback={() => <div>boundary error</div>}>
        <Suspense fallback={<div>loading</div>}>{children}</Suspense>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

function mockAvailability(payload: SeasonAvailabilityResponse) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status: 200 }),
  );
}

const SEASONS: SeasonInfo[] = [
  {
    seasonNumber: 1,
    name: "Season 1",
    totalEpisodes: 2,
    episodes: [
      { episodeNumber: 1, title: "Pilot", airDate: "2024-01-01", runtime: 50 },
      { episodeNumber: 2, title: "Cat's in the Bag…", airDate: "2024-01-08", runtime: 50 },
    ],
  },
];

describe("SeasonsList", () => {
  it("renders a season row joined from canonical + server presence", async () => {
    mockAvailability({
      servers: [
        {
          serverId: "plex:c1",
          serverLabel: "Plex",
          episodesPresent: [
            { season: 1, episode: 1 },
            { season: 1, episode: 2 },
          ],
        },
      ],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    await waitFor(() => expect(screen.getByText("Pilot")).toBeTruthy());
    expect(screen.getByText("Cat's in the Bag…")).toBeTruthy();
  });

  it("shows the no-servers hint when servers and errors are empty", async () => {
    mockAvailability({ servers: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    await waitFor(() => expect(screen.getByText(/No connected library servers/i)).toBeTruthy());
  });

  it("renders inline microcopy for per-plugin failures alongside successful servers", async () => {
    mockAvailability({
      servers: [
        {
          serverId: "plex:c1",
          serverLabel: "Plex",
          episodesPresent: [{ season: 1, episode: 1 }],
        },
      ],
      errors: [{ serverId: "jellyfin:c2", serverLabel: "Jellyfin", code: "plugin.upstream_error" }],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    await waitFor(() => expect(screen.getByText(/Jellyfin unreachable/i)).toBeTruthy());
    expect(screen.getByText("Pilot")).toBeTruthy();
  });

  it("falls through the ErrorBoundary when the fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    await waitFor(() => expect(screen.getByText("boundary error")).toBeTruthy());
  });
});
