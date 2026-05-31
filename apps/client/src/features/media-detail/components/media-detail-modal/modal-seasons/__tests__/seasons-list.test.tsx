// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, type ReactNode } from "react";
import type { SeasonAvailabilityResponse, SeasonInfo } from "@ent-mcp/shared/home";
import type { RequestTarget } from "@ent-mcp/shared/media";
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

type Endpoints = {
  availability?: SeasonAvailabilityResponse;
  availabilityStatus?: number;
  targets?: RequestTarget[];
  history?: { items: unknown[] };
};

function mockEndpoints({
  availability,
  availabilityStatus = 200,
  targets = [],
  history = { items: [] },
}: Endpoints) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/availability")) {
      const body = availability ? JSON.stringify(availability) : "boom";
      return new Response(body, { status: availabilityStatus });
    }
    if (url.includes("/api/requests/targets")) {
      return new Response(JSON.stringify({ targets }), { status: 200 });
    }
    if (url.includes("/api/requests")) {
      return new Response(JSON.stringify(history), { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
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

const TV_TARGET: RequestTarget = {
  serviceId: "conn-1:5",
  pluginId: "seerr",
  label: "Sonarr Main",
  exposesProfiles: false,
  defaultProfileId: null,
  profiles: [],
};

describe("SeasonsList", () => {
  it("renders a season row joined from canonical + server presence", async () => {
    mockEndpoints({
      availability: {
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
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    await waitFor(() => expect(screen.getByText("Pilot")).toBeTruthy());
    expect(screen.getByText("Cat's in the Bag…")).toBeTruthy();
  });

  it("shows the no-servers hint when servers and errors are empty", async () => {
    mockEndpoints({ availability: { servers: [] } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    await waitFor(() => expect(screen.getByText(/No connected library servers/i)).toBeTruthy());
  });

  it("renders inline microcopy for per-plugin failures alongside successful servers", async () => {
    mockEndpoints({
      availability: {
        servers: [
          {
            serverId: "plex:c1",
            serverLabel: "Plex",
            episodesPresent: [{ season: 1, episode: 1 }],
          },
        ],
        errors: [
          { serverId: "jellyfin:c2", serverLabel: "Jellyfin", code: "plugin.upstream_error" },
        ],
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    await waitFor(() => expect(screen.getByText(/Jellyfin unreachable/i)).toBeTruthy());
    expect(screen.getByText("Pilot")).toBeTruthy();
  });

  it("falls through the ErrorBoundary when the availability fetch rejects", async () => {
    mockEndpoints({ availabilityStatus: 500 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    await waitFor(() => expect(screen.getByText("boundary error")).toBeTruthy());
  });

  it("renders a season request action when a TV request target is configured (issue #211)", async () => {
    mockEndpoints({
      availability: { servers: [] },
      targets: [TV_TARGET],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    // Missing season collapses to "Request missing" when targets exist.
    const trigger = await waitFor(() => screen.getByRole("button", { name: /request missing/i }));
    fireEvent.click(trigger);
    await waitFor(() => screen.getByRole("button", { name: /request season/i }));
  });

  it("renders a disabled no-plugin affordance when no request targets are configured", async () => {
    mockEndpoints({
      availability: { servers: [] },
      targets: [],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SeasonsList tmdbId="1396" itemTitle="Show" seasons={SEASONS} />, {
      wrapper: withClient(client),
    });
    const noPlugin = await waitFor(() =>
      screen.getByRole("button", { name: /no plugin configured/i }),
    );
    expect((noPlugin as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^request missing$/i })).toBeNull();
  });
});
