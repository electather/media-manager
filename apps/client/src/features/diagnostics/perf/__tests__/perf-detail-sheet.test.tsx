// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { m } from "@/paraglide/messages";
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
