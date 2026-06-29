// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Stub the diagnostics seam so the boundary's reportError call does not hit the
// network; everything else (ErrorPage render, typed-status read) runs as-written.
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/shared/lib/diagnostics/report", () => ({ reportError: report.reportError }));

import { OnboardingErrorBoundary } from "../lib/error-boundary";
import { onboardingKeys } from "../lib/query-keys";
import { OnboardingApiError } from "../lib/types";

function Boom(): ReactNode {
  throw new OnboardingApiError(503, { code: "unavailable", message: "down" });
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderBoundary(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <OnboardingErrorBoundary>
        <Boom />
      </OnboardingErrorBoundary>
    </QueryClientProvider>,
  );
}

// React logs to console.error whenever the class boundary catches; silence it so
// passing runs don't spam CI output.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  report.reportError.mockReset();
});

describe("OnboardingErrorBoundary", () => {
  // The point of the boundary (architecture rule 3): the fallback must read the
  // typed OnboardingApiError.status, not a hardcoded generic code. If the
  // `instanceof OnboardingApiError` branch regresses, "503" stops rendering.
  it("surfaces the typed OnboardingApiError status in the fallback", async () => {
    renderBoundary(makeClient());

    expect(await screen.findByText("We couldn't load setup")).toBeTruthy();
    expect(screen.getByText("503")).toBeTruthy();
    expect(report.reportError).toHaveBeenCalledWith(
      expect.any(OnboardingApiError),
      "warning",
      expect.anything(),
      "client.onboarding.boundary",
    );
  });

  // The other load-bearing branch: clicking Retry flips isResetting, which swaps
  // the alert for the skeleton synchronously before the reset settles. Also pins
  // that both keys are reset — public-config is keyed outside onboardingKeys.all.
  it("shows the skeleton and hides the alert during the retry transition", () => {
    const client = makeClient();
    const resetSpy = vi.spyOn(client, "resetQueries");
    const { container } = renderBoundary(client);

    expect(screen.getByRole("alert")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });

    expect(resetSpy).toHaveBeenCalledWith({ queryKey: onboardingKeys.all });
    expect(resetSpy).toHaveBeenCalledWith({ queryKey: onboardingKeys.publicConfig() });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  // Pins the shared ErrorBoundary contract: the base componentDidCatch skips its
  // generic report when a feature fallback is present, so telemetry fires once
  // (the typed "warning"), not twice.
  it("does not double-fire telemetry from the base ErrorBoundary", () => {
    renderBoundary(makeClient());

    expect(report.reportError.mock.calls).toHaveLength(1);
    expect(report.reportError.mock.calls[0]?.[1]).toBe("warning");
  });
});
