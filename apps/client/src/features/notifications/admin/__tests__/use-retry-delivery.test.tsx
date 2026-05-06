// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchersMock = vi.hoisted(() => ({ fetchRetryDelivery: vi.fn() }));
vi.mock("../../shared/fetchers", () => fetchersMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useRetryDelivery } from "../use-retry-delivery";
import { notificationsKeys } from "../../shared/query-keys";
import { NotificationsApiError } from "../../shared/types";

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
  fetchersMock.fetchRetryDelivery.mockReset();
  for (const fn of Object.values(toastMock)) fn.mockReset();
});
afterEach(() => cleanup());

describe("useRetryDelivery", () => {
  it("warns with the in-flight toast on 409", async () => {
    fetchersMock.fetchRetryDelivery.mockRejectedValue(new NotificationsApiError(409, null));
    const qc = makeClient();
    const { result } = renderHook(() => useRetryDelivery(), { wrapper: withClient(qc) });
    await act(async () => {
      try {
        await result.current.mutateAsync("d_1");
      } catch {
        // intentional — verifying toast path
      }
    });
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("invalidates both the list and the delivery detail on success", async () => {
    fetchersMock.fetchRetryDelivery.mockResolvedValue({});
    const qc = makeClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRetryDelivery(), { wrapper: withClient(qc) });
    await act(async () => {
      await result.current.mutateAsync("d_42");
    });
    const calls = spy.mock.calls.map(([arg]) => arg?.queryKey);
    expect(calls).toContainEqual(notificationsKeys.admin.deliveriesAll());
    expect(calls).toContainEqual(notificationsKeys.admin.delivery("d_42"));
  });
});
