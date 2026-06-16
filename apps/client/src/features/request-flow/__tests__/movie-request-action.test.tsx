// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MediaRequest, RequestTarget } from "@nama/shared/media";

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

import { MovieRequestAction } from "../components/movie-request-action";
import { RequestError } from "../lib/types";

const TARGETS: RequestTarget[] = [
  {
    serviceId: "conn-1:1",
    pluginId: "seerr",
    label: "Radarr Main",
    exposesProfiles: true,
    defaultProfileId: "5",
    profiles: [{ id: "5", label: "1080p" }],
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

async function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
  await waitFor(() => screen.getByRole("button", { name: /request movie/i }));
}

describe("MovieRequestAction", () => {
  it("flips status to pending via optimistic cache, persists after success refetch", async () => {
    apiMock.targets.mockResolvedValueOnce(TARGETS);
    const persisted: MediaRequest = {
      id: "r-42",
      tmdbId: "550",
      type: "movie",
      title: "Fight Club",
      status: "pending",
      seasons: [],
      targetLabel: "Radarr Main",
      profileLabel: "1080p",
      createdAt: "2026-05-09T00:00:00Z",
    };
    apiMock.create.mockImplementationOnce(async () => {
      apiMock.history.mockResolvedValue({ items: [persisted] });
      return { requestId: "42" };
    });

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: /request movie/i }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalledTimes(1));
    expect(apiMock.create).toHaveBeenCalledWith({
      tmdbId: "550",
      mediaType: "movie",
      serviceId: "conn-1:1",
      profileId: "5",
    });
    await waitFor(() => screen.getByText(/awaiting approval/i));
  });

  it("keeps pending UI when seerr returns success with awaiting-approval (no refetch race)", async () => {
    apiMock.targets.mockResolvedValueOnce(TARGETS);
    apiMock.create.mockResolvedValueOnce({ requestId: "r-99" });
    // Simulate seerr lag: history endpoint still returns the empty list it
    // had before the request was created. The component must NOT flip back
    // to the request button on this stale fetch.
    apiMock.history.mockResolvedValue({ items: [] });

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: /request movie/i }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalledTimes(1));
    // Pending UI from seeded post-success row, not from a refetch.
    await waitFor(() => screen.getByText(/awaiting approval/i));
    expect(screen.queryByRole("button", { name: /^request$/i })).toBeNull();
  });

  it("rolls the optimistic row back on error, leaving the request button rearmed", async () => {
    apiMock.targets.mockResolvedValueOnce(TARGETS);
    apiMock.create.mockRejectedValueOnce(
      new RequestError(502, { code: "request.provider_failed", message: "boom" }),
    );

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: /request movie/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/awaiting approval/i)).toBeNull());
    expect(screen.getByRole("button", { name: /^request$/i })).toBeTruthy();
  });

  it("renders pending purely from useUserRequests when a matching row exists (reload sim)", async () => {
    const row: MediaRequest = {
      id: "r-9",
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

  it("shows the empty state when no targets are configured", async () => {
    apiMock.targets.mockResolvedValueOnce([]);

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
    await waitFor(() => screen.getByText(/no request services configured/i));
  });
});
