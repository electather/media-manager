// @vitest-environment happy-dom
// Regression test for issue #216: the request flow used to call only a local
// `onSubmit` handler and never reached the server. Asserts that submitting
// the picker actually invokes `requestsApi.create`.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RequestTarget } from "@nama/shared/media";

const apiMock = vi.hoisted(() => ({ targets: vi.fn(), create: vi.fn() }));
vi.mock("../api/client", () => ({ requestsApi: apiMock }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { MovieRequestAction } from "../components/movie-request-action";

const TARGETS: RequestTarget[] = [
  {
    serviceId: "conn-1:1",
    pluginId: "seerr",
    label: "Radarr Main",
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

beforeEach(() => {
  apiMock.targets.mockReset();
  apiMock.create.mockReset();
});

afterEach(() => cleanup());

describe("issue #216 regression", () => {
  it("MovieRequestAction submission invokes requestsApi.create", async () => {
    apiMock.targets.mockResolvedValueOnce(TARGETS);
    apiMock.create.mockResolvedValueOnce({ requestId: "42" });

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
    await waitFor(() => screen.getByRole("button", { name: /request movie/i }));
    fireEvent.click(screen.getByRole("button", { name: /request movie/i }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalled());
    expect(apiMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbId: "550",
        mediaType: "movie",
        serviceId: "conn-1:1",
      }),
    );
  });
});
