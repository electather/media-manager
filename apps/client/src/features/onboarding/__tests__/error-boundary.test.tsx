// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Stub the diagnostics seam so the boundary's reportError call does not hit the
// network; everything else (ErrorPage render, typed-status read) runs as-written.
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/shared/lib/diagnostics/report", () => ({ reportError: report.reportError }));

import { OnboardingErrorBoundary } from "../lib/error-boundary";
import { OnboardingApiError } from "../lib/types";

function renderBoundary(child: ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OnboardingErrorBoundary>{child}</OnboardingErrorBoundary>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  report.reportError.mockReset();
});

describe("OnboardingErrorBoundary", () => {
  // The point of the boundary (architecture rule 3): the fallback must read the
  // typed OnboardingApiError.status, not a hardcoded generic code. If the
  // `instanceof OnboardingApiError` branch regresses, "503" stops rendering.
  it("surfaces the typed OnboardingApiError status in the fallback", async () => {
    function Boom(): ReactNode {
      throw new OnboardingApiError(503, { code: "unavailable", message: "down" });
    }

    renderBoundary(<Boom />);

    expect(await screen.findByText("We couldn't load setup")).not.toBeNull();
    expect(screen.getByText("503")).not.toBeNull();
    expect(report.reportError).toHaveBeenCalledWith(
      expect.any(OnboardingApiError),
      "warning",
      expect.anything(),
      "client.onboarding.boundary",
    );
  });
});
