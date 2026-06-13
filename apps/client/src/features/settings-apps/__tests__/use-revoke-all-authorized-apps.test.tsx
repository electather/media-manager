// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AuthorizedApp } from "@nama/shared/users";

const fetchersMock = vi.hoisted(() => ({ revokeAuthorizedApp: vi.fn() }));
vi.mock("../lib/fetchers", () => fetchersMock);

import { useRevokeAllAuthorizedApps } from "../hooks/use-revoke-all-authorized-apps";
import { settingsAppsKeys } from "../lib/query-keys";

function makeApp(clientId: string): AuthorizedApp {
  return {
    clientId,
    name: clientId,
    scopes: [],
    connectedAt: 1,
    lastUsedAt: null,
    ownedByUser: false,
    status: "active",
  };
}

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
  fetchersMock.revokeAuthorizedApp.mockReset();
});

afterEach(() => cleanup());

describe("useRevokeAllAuthorizedApps", () => {
  it("revokes every app and reports partial failures before invalidating the apps query", async () => {
    const qc = makeClient();
    const apps = [makeApp("a"), makeApp("b"), makeApp("c")];
    qc.setQueryData(settingsAppsKeys.authorizedApps(), apps);
    fetchersMock.revokeAuthorizedApp.mockImplementation((clientId: string) =>
      clientId === "b" ? Promise.reject(new Error("failed")) : Promise.resolve([]),
    );

    const { result } = renderHook(() => useRevokeAllAuthorizedApps(), { wrapper: withClient(qc) });
    let outcome: { count: number; failed: number } | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync(apps);
    });

    expect(fetchersMock.revokeAuthorizedApp.mock.calls.map(([clientId]) => clientId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(outcome).toEqual({ count: 3, failed: 1 });
    expect(qc.getQueryState(settingsAppsKeys.authorizedApps())?.isInvalidated).toBe(true);
  });
});
