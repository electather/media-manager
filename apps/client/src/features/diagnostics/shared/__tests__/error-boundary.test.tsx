// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { m } from "@/paraglide/messages";
import { DiagnosticsErrorBoundary } from "../error-boundary";

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

    expect(screen.getByText(m.diagnostics_perf_load_failed_title())).toBeDefined();
    expect(screen.queryByText(m.diagnostics_errors_load_failed_title())).toBeNull();
  });

  it("falls back to the errors copy when no override is passed", () => {
    renderBoundary(
      <DiagnosticsErrorBoundary>
        <Boom />
      </DiagnosticsErrorBoundary>,
    );

    expect(screen.getByText(m.diagnostics_errors_load_failed_title())).toBeDefined();
  });
});
