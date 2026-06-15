// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RequestTarget } from "@nama/shared/media";
import type { Season } from "../lib/types";

const apiMock = vi.hoisted(() => ({
  targets: vi.fn(),
  create: vi.fn(),
  history: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../lib/fetchers", () => ({ requestsApi: apiMock }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

import { MovieRequestAction } from "../components/movie-request-action";
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

function withClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const seasonsForId = (suffix: string): Season[] => [
  {
    number: 1,
    episodeCount: 2,
    counts: { unavailable: 2 },
    episodes: [
      {
        id: `${suffix}-s1e1`,
        episode: 1,
        title: "Pilot",
        airDate: "2024-01-01",
        runtime: 42,
        status: "unavailable",
      },
      {
        id: `${suffix}-s1e2`,
        episode: 2,
        title: "Aftershock",
        airDate: "2024-01-08",
        runtime: 42,
        status: "unavailable",
      },
    ],
  },
];

beforeEach(() => {
  apiMock.targets.mockReset();
  apiMock.create.mockReset();
  apiMock.history.mockReset();
  apiMock.cancel.mockReset();
  apiMock.history.mockResolvedValue({ items: [] });
  apiMock.targets.mockResolvedValue(TARGETS);
});

afterEach(() => cleanup());

describe("MovieRequestAction reset on item change", () => {
  it("does not leak pending state when the parent navigates to a new movie", async () => {
    apiMock.create.mockResolvedValueOnce({ requestId: "r-a" });
    const Wrapper = withClient();
    const { rerender } = render(
      <Wrapper>
        <MovieRequestAction itemId="movie:a" itemTitle="Movie A" initialStatus="unavailable" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
    await waitFor(() => screen.getByRole("button", { name: /^request movie$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^request movie$/i }));
    await waitFor(() => screen.getByText(/awaiting approval/i));

    rerender(
      <Wrapper>
        <MovieRequestAction itemId="movie:b" itemTitle="Movie B" initialStatus="unavailable" />
      </Wrapper>,
    );

    expect(screen.queryByText(/awaiting approval/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^request$/i })).toBeTruthy();
  });
});

describe("RequestableSeasons reset on item change", () => {
  it("does not leak per-season pending between titles", async () => {
    apiMock.create.mockResolvedValueOnce({ requestId: "r-s1" });
    const Wrapper = withClient();
    const { rerender } = render(
      <Wrapper>
        <RequestableSeasons itemId="tv:a" itemTitle="Show A" seasons={seasonsForId("a")} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: /request missing/i }));
    await waitFor(() => screen.getByRole("button", { name: /request season/i }));
    fireEvent.click(screen.getByRole("button", { name: /request season/i }));
    await waitFor(() => screen.getByText(/awaiting approval/i));

    rerender(
      <Wrapper>
        <RequestableSeasons itemId="tv:b" itemTitle="Show B" seasons={seasonsForId("b")} />
      </Wrapper>,
    );

    expect(screen.queryByText(/awaiting approval/i)).toBeNull();
    expect(screen.getByRole("button", { name: /request missing/i })).toBeTruthy();
  });

  it("does not violate hook order when seasons load from empty to populated", () => {
    // The detail modal mounts this component before season availability
    // resolves through Suspense, so the initial render can land with an
    // empty seasons array and rerender once the data arrives. All hooks
    // must run on both renders or React throws "Rendered more hooks than
    // during the previous render".
    const Wrapper = withClient();
    const { rerender } = render(
      <Wrapper>
        <RequestableSeasons itemId="tv:c" itemTitle="Show C" seasons={[]} />
      </Wrapper>,
    );

    expect(() =>
      rerender(
        <Wrapper>
          <RequestableSeasons itemId="tv:c" itemTitle="Show C" seasons={seasonsForId("c")} />
        </Wrapper>,
      ),
    ).not.toThrow();

    expect(screen.getByRole("button", { name: /request missing/i })).toBeTruthy();
  });
});
