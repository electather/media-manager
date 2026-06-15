// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import type { MediaRequestsResponse } from "@nama/shared/media";

const apiMock = vi.hoisted(() => ({
  targets: vi.fn(),
  create: vi.fn(),
  history: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../lib/fetchers", () => ({ requestsApi: apiMock }));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { useCancelRequest } from "../hooks/use-cancel-request";
import { useCreateRequest } from "../hooks/use-create-request";
import { requestFlowKeys } from "../lib/query-keys";

function withClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  apiMock.create.mockReset();
  apiMock.cancel.mockReset();
  apiMock.history.mockReset();
});

afterEach(() => cleanup());

describe("cancel during optimistic window", () => {
  it("synthetic short-circuit removes optimistic row without calling DELETE", async () => {
    const { qc, Wrapper } = withClient();
    qc.setQueryData<MediaRequestsResponse>(requestFlowKeys.history(), { items: [] });

    // Stall the create so the optimistic row stays around.
    let resolveCreate: (v: unknown) => void = () => {};
    apiMock.create.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveCreate = res;
        }),
    );

    const { result } = renderHook(
      () => ({ qc: useQueryClient(), create: useCreateRequest(), cancel: useCancelRequest() }),
      { wrapper: Wrapper },
    );

    // Fire create — onMutate writes optimistic row.
    void result.current.create.mutateAsync({
      tmdbId: "550",
      mediaType: "movie",
      serviceId: "conn-1:1",
    });

    await waitFor(() => {
      const cache = qc.getQueryData<MediaRequestsResponse>(requestFlowKeys.history());
      expect(cache?.items.length).toBe(1);
      expect(cache?.items[0]?.id.startsWith("__optimistic-")).toBe(true);
    });

    const optimisticId = qc.getQueryData<MediaRequestsResponse>(requestFlowKeys.history())!
      .items[0]!.id;

    // Cancel the optimistic id — must NOT hit the network.
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const cancelOut = await result.current.cancel.mutateAsync({ requestId: optimisticId });
    expect(cancelOut).toEqual({ ok: true, synthetic: true });
    expect(apiMock.cancel).not.toHaveBeenCalled();

    const cacheAfter = qc.getQueryData<MediaRequestsResponse>(requestFlowKeys.history());
    expect(cacheAfter?.items.length).toBe(0);

    // Synthetic branch does NOT invalidate.
    const wasInvalidated = invalidateSpy.mock.calls.some(
      ([opts]) => Array.isArray(opts?.queryKey) && opts.queryKey[1] === "history",
    );
    expect(wasInvalidated).toBe(false);

    // Drain pending create.
    resolveCreate({ requestId: "42" });
  });

  it("drops the optimistic row and invalidates when the server settles with requestId: null", async () => {
    const { qc, Wrapper } = withClient();
    qc.setQueryData<MediaRequestsResponse>(requestFlowKeys.history(), { items: [] });

    // The server can legitimately return a successful create with no id; the
    // synthetic `__optimistic-*` id must not survive as the row's identity,
    // because Cancel short-circuits those ids and could never reach the live
    // server request (the bug behind #619).
    apiMock.create.mockResolvedValueOnce({ requestId: null });

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateRequest(), { wrapper: Wrapper });

    await result.current.mutateAsync({ tmdbId: "550", mediaType: "movie", serviceId: "conn-1:1" });

    // No row retains a synthetic id after a null-id settle.
    const cache = qc.getQueryData<MediaRequestsResponse>(requestFlowKeys.history());
    expect(cache?.items.some((r) => r.id.startsWith("__optimistic-"))).toBe(false);

    // History is invalidated so a refetch reconciles the live server request.
    const historyInvalidated = invalidateSpy.mock.calls.some(
      ([opts]) => Array.isArray(opts?.queryKey) && opts.queryKey[1] === "history",
    );
    expect(historyInvalidated).toBe(true);
  });
});
