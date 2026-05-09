// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MediaRequest } from "@ent-mcp/shared/media";

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
import { RequestError } from "../api/errors";

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

const baseRow: MediaRequest = {
  id: "r-real",
  tmdbId: "550",
  type: "movie",
  title: "Fight Club",
  status: "pending",
  seasons: [],
  targetLabel: "Radarr Main",
  profileLabel: "1080p",
  createdAt: "2026-05-09T00:00:00Z",
};

describe("cancel flow", () => {
  it("calls requestsApi.cancel with the real id and clears the overlay on success", async () => {
    apiMock.history.mockResolvedValueOnce({ items: [baseRow] });
    apiMock.cancel.mockImplementationOnce(async () => {
      apiMock.history.mockResolvedValue({ items: [] });
      return { ok: true as const };
    });

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    await waitFor(() => screen.getByText(/awaiting approval/i));
    const cancelBtn = screen.getByRole("button", { name: /cancel request/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => expect(apiMock.cancel).toHaveBeenCalledWith("r-real"));
    await waitFor(() => screen.getByRole("button", { name: /^request$/i }));
  });

  it("rolls the cache back and surfaces a toast on cancel failure", async () => {
    apiMock.history.mockResolvedValue({ items: [baseRow] });
    apiMock.cancel.mockRejectedValueOnce(
      new RequestError(502, { code: "request.provider_failed", message: "boom" }),
    );

    const Wrapper = withClient();
    render(
      <Wrapper>
        <MovieRequestAction itemId="movie:550" itemTitle="Fight Club" initialStatus="missing" />
      </Wrapper>,
    );

    await waitFor(() => screen.getByText(/awaiting approval/i));
    fireEvent.click(screen.getByRole("button", { name: /cancel request/i }));

    await waitFor(() => expect(apiMock.cancel).toHaveBeenCalled());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    // Pending overlay restored after rollback.
    expect(screen.getByText(/awaiting approval/i)).toBeTruthy();
  });
});
