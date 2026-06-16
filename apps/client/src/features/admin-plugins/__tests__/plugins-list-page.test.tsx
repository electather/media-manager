// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchersMock = vi.hoisted(() => ({
  fetchPluginsList: vi.fn(),
  fetchSetEnabled: vi.fn(),
  fetchGlobalConfig: vi.fn(),
  fetchSaveGlobalConfig: vi.fn(),
  fetchSetFallback: vi.fn(),
  fetchSetAdminAllowlist: vi.fn(),
  fetchSetAdminHeader: vi.fn(),
  fetchUninstallPlugin: vi.fn(),
}));
vi.mock("../shared/fetchers", () => fetchersMock);

const reportSpy = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}));
vi.mock("@/shared/lib/diagnostics/report", () => ({
  reportError: (...args: unknown[]) => reportSpy(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: {
    children?: ReactNode;
    to?: unknown;
    params?: unknown;
  }) => <a {...(rest as object)}>{children}</a>,
}));

import { AdminPluginsErrorBoundary, PluginsListPage, PluginsListSkeleton } from "../index";
import { AdminPluginsApiError } from "../shared/types";

function makePlugin({ id, name, enabled = true }: { id: string; name: string; enabled?: boolean }) {
  return {
    id,
    version: "1.0.0",
    sourceType: "builtin",
    enabled,
    hasGlobalConfig: false,
    sharedCredentialsCount: 0,
    sharedCredentialsEnabledCount: 0,
    personalKeyFallback: "off",
    poolable: false,
    capabilities: [{ id: "search", version: "v1", scope: "global" as const }],
    manifest: { name, description: "" },
    isPureGlobal: true,
    installedAt: 0,
    updatedAt: 0,
    isBuiltin: true,
    advanced: { adminAllowlist: null, adminHeaderNames: [] },
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage() {
  const qc = makeClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AdminPluginsErrorBoundary>
        <Suspense fallback={<PluginsListSkeleton />}>
          <PluginsListPage />
        </Suspense>
      </AdminPluginsErrorBoundary>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

beforeEach(() => {
  for (const fn of Object.values(fetchersMock)) fn.mockReset();
  reportSpy.mockClear();
  // Suppress React error boundary console noise for all tests; only error
  // state tests trigger it, but restoring per-test via afterEach is sufficient.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("admin plugins list — query state coverage", () => {
  it("shows the skeleton fallback while the plugins query is in flight", () => {
    // Never-resolving promise keeps Suspense in the pending state for the
    // duration of the assertion.
    fetchersMock.fetchPluginsList.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status", { name: /loading plugins/i })).toBeTruthy();
    expect(screen.queryByText(/no plugins installed/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the empty-state copy when the query resolves with no plugins", async () => {
    fetchersMock.fetchPluginsList.mockResolvedValue({ plugins: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no plugins installed/i)).toBeTruthy();
    });
    // Built-in registration copy stays attached to the empty state — that
    // message only makes sense when the API actually returned zero plugins.
    expect(screen.getByText(/built-in plugins register on server boot/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders one row per plugin when the query resolves with plugins", async () => {
    fetchersMock.fetchPluginsList.mockResolvedValue({
      plugins: [
        makePlugin({ id: "tmdb", name: "TMDB" }),
        makePlugin({ id: "trakt", name: "Trakt", enabled: false }),
      ],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("TMDB")).toBeTruthy();
    });
    expect(screen.getByText("Trakt")).toBeTruthy();
    expect(screen.queryByText(/no plugins installed/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the error/retry state instead of the empty state when the query fails", async () => {
    fetchersMock.fetchPluginsList.mockRejectedValue(
      new AdminPluginsApiError(500, { code: "plugins.internal", message: "boom" }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    // The bug this guards against: when the query failed the page used to
    // render the misleading "No plugins installed" empty copy.
    expect(screen.queryByText(/no plugins installed/i)).toBeNull();
    expect(screen.getByText(/couldn't load plugins/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(reportSpy).toHaveBeenCalledOnce();
  });

  it("retries the plugins query when the user clicks Retry from the error state", async () => {
    fetchersMock.fetchPluginsList
      .mockRejectedValueOnce(new AdminPluginsApiError(500, { code: "plugins.internal" }))
      .mockResolvedValueOnce({ plugins: [makePlugin({ id: "tmdb", name: "TMDB" })] });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(fetchersMock.fetchPluginsList).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText("TMDB")).toBeTruthy();
    });
    expect(fetchersMock.fetchPluginsList).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/no plugins installed/i)).toBeNull();
  });
});

describe("admin plugins list — install CTA visibility", () => {
  it("hides the Install plugin button when canInstall is false", async () => {
    // canInstall is hard-coded to false in PluginsListPage (install UI is a
    // non-goal per plugin-advanced-admin-design.md §1). This test locks that in.
    fetchersMock.fetchPluginsList.mockResolvedValue({
      plugins: [makePlugin({ id: "tmdb", name: "TMDB" })],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("TMDB")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /install plugin/i })).toBeNull();
  });
});
