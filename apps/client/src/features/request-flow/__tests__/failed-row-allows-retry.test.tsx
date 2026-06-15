// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MediaRequest } from "@nama/shared/media";

const apiMock = vi.hoisted(() => ({
  targets: vi.fn(),
  create: vi.fn(),
  history: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../lib/fetchers", () => ({ requestsApi: apiMock }));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { MovieRequestAction } from "../components/movie-request-action";

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
});

afterEach(() => cleanup());

describe("failed-status row drops the overlay so retry is enabled", () => {
  it("MovieRequestAction renders the request button when matching row is failed", async () => {
    const failedRow: MediaRequest = {
      id: "r-fail",
      tmdbId: "550",
      type: "movie",
      title: "Fight Club",
      status: "failed",
      seasons: [],
      targetLabel: null,
      profileLabel: null,
      createdAt: "2026-05-09T00:00:00Z",
    };
    apiMock.history.mockResolvedValue({ items: [failedRow] });

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    await waitFor(() => screen.getByRole("button", { name: /^request$/i }));
    expect(screen.queryByText(/awaiting approval/i)).toBeNull();
  });
});
