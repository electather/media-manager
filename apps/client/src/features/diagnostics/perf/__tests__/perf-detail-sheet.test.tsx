// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { m } from "@/paraglide/messages";
import type { PerfAggregateGroup } from "../../shared/types";
import { PerfDetailSheet } from "../perf-detail-sheet";

// reportError fires a network call on catch; stub it so the test stays network-free.
vi.mock("@/shared/lib/diagnostics/report", () => ({ reportError: vi.fn() }));

// The router Link only needs a render stub here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

// Control whether the detail fetch succeeds or throws from within the test.
const fetcherMock = vi.hoisted(() => ({ fetchPerfDetail: vi.fn() }));
vi.mock("../../shared/fetchers", () => fetcherMock);

const originalConsoleError = console.error;
beforeEach(() => {
  // Suppress the expected React error boundary console output in tests.
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
  cleanup();
  vi.clearAllMocks();
});

function renderSheet(detailId: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <PerfDetailSheet group={null} detailId={detailId} onClose={vi.fn()} onJumpThread={vi.fn()} />
    </QueryClientProvider>,
  );
  return {
    client,
    rerender: (nextId: string | null) =>
      rerender(
        <QueryClientProvider client={client}>
          <PerfDetailSheet
            group={null}
            detailId={nextId}
            onClose={vi.fn()}
            onJumpThread={vi.fn()}
          />
        </QueryClientProvider>,
      ),
  };
}

function makeGroup(over: Partial<PerfAggregateGroup> = {}): PerfAggregateGroup {
  return {
    kind: "http",
    route: "/api/catalog",
    pluginId: null,
    count: 42,
    p50: 80,
    p95: 250,
    p99: 500,
    max: 1200,
    lastAt: 1_700_000_000_000,
    ...over,
  };
}

function renderGroupSheet(group: PerfAggregateGroup) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PerfDetailSheet group={group} detailId={null} onClose={vi.fn()} onJumpThread={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("PerfDetailSheet — group path", () => {
  // When a caller supplies a `group` prop the sheet must render the aggregate
  // header and the distribution stats immediately — no fetch is required.  This
  // is the "table row click" flow; deep-link navigation uses `detailId` instead.
  it("shows the group route in the sheet title", () => {
    renderGroupSheet(makeGroup({ route: "/api/catalog" }));

    expect(screen.getByText("/api/catalog")).toBeDefined();
  });

  it("shows the percentile stat labels without fetching", () => {
    renderGroupSheet(makeGroup({ count: 42, p50: 80, p95: 250, p99: 500, max: 1200 }));

    // The distribution section heading must appear, confirming GroupBody rendered.
    expect(screen.getByText(m.diagnostics_perf_detail_distribution())).toBeDefined();
    // The four stat labels must be present.
    expect(screen.getByText(m.diagnostics_perf_label_p50())).toBeDefined();
    expect(screen.getByText(m.diagnostics_perf_label_p95())).toBeDefined();
    expect(screen.getByText(m.diagnostics_perf_label_p99())).toBeDefined();
    expect(screen.getByText(m.diagnostics_perf_label_max())).toBeDefined();
    expect(fetcherMock.fetchPerfDetail).not.toHaveBeenCalled();
  });

  it("falls back to pluginId in the title when route is null", () => {
    renderGroupSheet(makeGroup({ route: null, pluginId: "trakt", kind: "plugin" }));

    expect(screen.getByText("trakt")).toBeDefined();
  });

  it("falls back to unknown label when both route and pluginId are null", () => {
    renderGroupSheet(makeGroup({ route: null, pluginId: null, kind: "http" }));

    expect(screen.getByText(m.diagnostics_errors_table_unknown())).toBeDefined();
  });
});

describe("PerfDetailSheet — success path", () => {
  // When only `detailId` is supplied the sheet must suspend while fetching then
  // render the record's route once the query resolves.  The success path
  // verifies the happy path from the error-boundary+Suspense tree; the error
  // path is already covered by the boundary-reset test below.
  it("renders the fetched record's route after the query resolves", async () => {
    fetcherMock.fetchPerfDetail.mockResolvedValueOnce({
      record: {
        id: "rec-1",
        requestId: "req-abc",
        kind: "http",
        durationMs: 320,
        route: "/api/search",
        method: "GET",
        status: 200,
        pluginId: null,
        userId: null,
        createdAt: 1_700_000_000_000,
      },
      correlatedErrors: [],
    });

    renderSheet("rec-1");

    // The route from the fetched record must appear in the sheet title once the
    // Suspense boundary resolves.
    await waitFor(() => {
      expect(screen.getByText("/api/search")).toBeDefined();
    });
  });
});

describe("PerfDetailSheet — boundary reset on detailId change", () => {
  // Without key={detailId}, changing detailId while the boundary holds an
  // error state leaves the sheet frozen on the error fallback. The user would
  // need to manually click Retry even though the underlying record changed.
  // key={detailId} forces React to remount the boundary on each ID change so
  // the error fallback is cleared automatically when the user picks a new row.
  it("clears the error fallback when detailId changes to a new value", async () => {
    // The first fetch for "perf-1" rejects so the boundary catches the error.
    fetcherMock.fetchPerfDetail.mockRejectedValueOnce(new Error("fetch failed"));
    // The second fetch for "perf-2" stays pending — it never resolves or rejects —
    // so the remounted boundary shows the Suspense skeleton, not an error fallback.
    fetcherMock.fetchPerfDetail.mockReturnValueOnce(new Promise(() => {}));

    const { rerender } = renderSheet("perf-1");

    // Wait for the suspended query to reject and the boundary to render the fallback.
    await waitFor(() => {
      expect(screen.getByText(m.diagnostics_perf_load_failed_title())).toBeDefined();
    });

    // Changing to a new ID must remount the boundary (key changes) so the error
    // fallback disappears — the fresh boundary shows the Suspense skeleton instead.
    await act(async () => {
      rerender("perf-2");
    });

    expect(screen.queryByText(m.diagnostics_perf_load_failed_title())).toBeNull();
  });
});
