// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchersMock = vi.hoisted(() => ({ fetchTestChannel: vi.fn() }));
vi.mock("@/features/notifications/shared/fetchers", () => fetchersMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useTestChannel } from "../hooks/use-test-channel";
import { NotificationsApiError } from "@/features/notifications/shared/types";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function withClient(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  fetchersMock.fetchTestChannel.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(() => cleanup());

describe("useTestChannel", () => {
  it("toasts success when the test fires", async () => {
    fetchersMock.fetchTestChannel.mockResolvedValue({});
    const { result } = renderHook(() => useTestChannel(), { wrapper: withClient(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync("conn_1");
    });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("toasts the API error message when the test fails", async () => {
    fetchersMock.fetchTestChannel.mockRejectedValue(
      new NotificationsApiError(500, { message: "smtp down" }),
    );
    const { result } = renderHook(() => useTestChannel(), { wrapper: withClient(makeClient()) });
    await act(async () => {
      try {
        await result.current.mutateAsync("conn_1");
      } catch {
        // intentional — verifying toast path
      }
    });
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("smtp down"));
    });
  });
});
