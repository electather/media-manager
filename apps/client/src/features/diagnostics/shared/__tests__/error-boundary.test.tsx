// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { m } from "@/paraglide/messages";
import { DiagnosticsErrorBoundary } from "../error-boundary";
import { diagnosticsKeys } from "../query-keys";

// reportError fires a network call on catch; stub it so the test stays
// network-free. The router Link only needs a render stub here.
vi.mock("@/shared/lib/diagnostics/report", () => ({ reportError: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
  cleanup();
  vi.clearAllMocks();
});

function Boom(): never {
  throw new Error("aggregate fetch failed");
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderBoundary(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("DiagnosticsErrorBoundary — surface-specific copy", () => {
  // The boundary wraps both the errors table and the perf-aggregate table.
  // A perf-table failure must show the performance copy, not "Couldn't load
  // diagnostics", so the user sees the right context for the tab they are on.
  it("renders the supplied perf copy when a wrapped read throws", () => {
    renderBoundary(
      <DiagnosticsErrorBoundary
        title={m.diagnostics_perf_load_failed_title()}
        body={m.diagnostics_perf_load_failed_body()}
      >
        <Boom />
      </DiagnosticsErrorBoundary>,
    );

    expect(screen.getByText(m.diagnostics_perf_load_failed_title())).toBeInTheDocument();
    expect(screen.queryByText(m.diagnostics_errors_load_failed_title())).toBeNull();
  });

  it("falls back to the errors copy when no override is passed", () => {
    renderBoundary(
      <DiagnosticsErrorBoundary>
        <Boom />
      </DiagnosticsErrorBoundary>,
    );

    expect(screen.getByText(m.diagnostics_errors_load_failed_title())).toBeInTheDocument();
  });
});

describe("DiagnosticsErrorBoundary — retry resets the right queries", () => {
  // The Retry button must call resetQueries with the surface's own query key so
  // that an errors-tab failure does not re-suspend the perf tab, and vice versa.
  it("resets only the provided queryKey when one is supplied", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const resetSpy = vi.spyOn(client, "resetQueries");
    const Wrapper = wrap(client);
    const scopedKey = diagnosticsKeys.errors.all();
    render(
      <Wrapper>
        <DiagnosticsErrorBoundary queryKey={scopedKey}>
          <Boom />
        </DiagnosticsErrorBoundary>
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: m.diagnostics_errors_retry() }));
    });

    // Must use the scoped key, not the broad diagnosticsKeys.all fallback.
    expect(resetSpy).toHaveBeenCalledWith({ queryKey: scopedKey });
    expect(resetSpy).not.toHaveBeenCalledWith({ queryKey: diagnosticsKeys.all });
  });

  it("falls back to diagnosticsKeys.all when no queryKey is supplied", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const resetSpy = vi.spyOn(client, "resetQueries");
    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <DiagnosticsErrorBoundary>
          <Boom />
        </DiagnosticsErrorBoundary>
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: m.diagnostics_errors_retry() }));
    });

    // With no queryKey prop, the fallback must broadcast to the full diagnostics tree.
    expect(resetSpy).toHaveBeenCalledWith({ queryKey: diagnosticsKeys.all });
  });
});
