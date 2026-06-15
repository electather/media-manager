// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchersMock = vi.hoisted(() => ({
  fetchToggleSubscription: vi.fn(),
  fetchDeleteChannel: vi.fn(),
  fetchRenameChannel: vi.fn(),
}));
vi.mock("@/features/notifications/shared/fetchers", () => fetchersMock);

import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import { useReplaceSubscriptions } from "../hooks/use-replace-subscriptions";
import { useDeleteChannel } from "../hooks/use-delete-channel";
import { useRenameChannel } from "../hooks/use-rename-channel";

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
  fetchersMock.fetchToggleSubscription.mockReset();
  fetchersMock.fetchDeleteChannel.mockReset();
  fetchersMock.fetchRenameChannel.mockReset();
});
afterEach(() => cleanup());

describe("useReplaceSubscriptions", () => {
  it("applies the whole diff in one optimistic patch — updating existing rows and adding new ones", async () => {
    // A single shared snapshot/patch is the core of the race fix: the batched
    // mutation must update an already-present row and append a missing one in
    // one pass so siblings never overwrite each other's optimistic writes.
    fetchersMock.fetchToggleSubscription.mockResolvedValue({});
    const qc = makeClient();
    qc.setQueryData(notificationsKeys.subscriptions(), {
      subscriptions: [{ connectionId: "c1", category: "media", enabled: true }],
    });

    const { result } = renderHook(() => useReplaceSubscriptions(), { wrapper: withClient(qc) });
    act(() => {
      result.current.mutate({
        connectionId: "c1",
        changes: [
          { category: "media", enabled: false },
          { category: "system", enabled: true },
        ],
      });
    });

    await waitFor(() => {
      const data = qc.getQueryData<{
        subscriptions: Array<{ connectionId: string; category: string; enabled: boolean }>;
      }>(notificationsKeys.subscriptions());
      expect(data?.subscriptions).toEqual([
        { connectionId: "c1", category: "media", enabled: false },
        { connectionId: "c1", category: "system", enabled: true },
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchersMock.fetchToggleSubscription).toHaveBeenCalledTimes(2);
  });

  it("rolls back to the single pre-mutation snapshot when any request fails", async () => {
    // Because the batch shares one snapshot, a rollback restores true server
    // state rather than another in-flight optimistic write.
    fetchersMock.fetchToggleSubscription.mockRejectedValue(new Error("boom"));
    const qc = makeClient();
    const original = {
      subscriptions: [{ connectionId: "c1", category: "media", enabled: true }],
    };
    qc.setQueryData(notificationsKeys.subscriptions(), original);

    const { result } = renderHook(() => useReplaceSubscriptions(), { wrapper: withClient(qc) });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          connectionId: "c1",
          changes: [
            { category: "media", enabled: false },
            { category: "system", enabled: true },
          ],
        });
      } catch {
        // intentional — verifying rollback path.
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(notificationsKeys.subscriptions())).toEqual(original);
  });
});

describe("useDeleteChannel", () => {
  it("optimistically removes the channel then rolls back on error", async () => {
    fetchersMock.fetchDeleteChannel.mockRejectedValue(new Error("nope"));
    const qc = makeClient();
    const original = { channels: [{ id: "c1" }, { id: "c2" }] };
    qc.setQueryData(notificationsKeys.channels(), original);

    const { result } = renderHook(() => useDeleteChannel(), { wrapper: withClient(qc) });
    await act(async () => {
      try {
        await result.current.mutateAsync("c1");
      } catch {
        // intentional — verifying rollback path.
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(notificationsKeys.channels())).toEqual(original);
  });
});

describe("useRenameChannel", () => {
  it("optimistically patches displayName, coercing an empty name to null", async () => {
    // The `|| null` coercion is business logic: an empty rename must clear the
    // custom name, not store an empty string.
    fetchersMock.fetchRenameChannel.mockResolvedValue({});
    const qc = makeClient();
    qc.setQueryData(notificationsKeys.channels(), {
      channels: [{ id: "c1", displayName: "old" }],
    });

    const { result } = renderHook(() => useRenameChannel(), { wrapper: withClient(qc) });
    act(() => {
      result.current.mutate({ id: "c1", displayName: "" });
    });

    await waitFor(() => {
      const data = qc.getQueryData<{ channels: Array<{ id: string; displayName: string | null }> }>(
        notificationsKeys.channels(),
      );
      expect(data?.channels[0]?.displayName).toBeNull();
    });
  });
});
