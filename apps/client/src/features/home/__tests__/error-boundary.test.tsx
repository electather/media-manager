// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { HomeErrorBoundary } from "../lib/error-boundary";
import { MediaApiError } from "@/shared/media/error";
import { homeKeys } from "../lib/query-keys";

const { reportSpy } = vi.hoisted(() => ({
  reportSpy: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));
vi.mock("@/shared/lib/diagnostics/report", () => ({
  reportError: (...args: unknown[]) => reportSpy(...args),
}));

function Boom({ error }: { error: Error }): null {
  throw error;
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  reportSpy.mockClear();
});

describe("HomeErrorBoundary", () => {
  it("renders the auth variant for 401 with a sign-in action", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = wrap(client);
    const err = new MediaApiError(401, {
      code: "http.unauthorized",
      devMessage: "session expired",
    });
    render(
      <Wrapper>
        <HomeErrorBoundary>
          <Boom error={err} />
        </HomeErrorBoundary>
      </Wrapper>,
    );
    expect(screen.getByText("session expired")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-home-error-variant")).toBe("auth");
  });

  it("renders the server variant for 5xx with a contact-support link", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = wrap(client);
    const err = new MediaApiError(503, { code: "home.internal", devMessage: "outage" });
    render(
      <Wrapper>
        <HomeErrorBoundary>
          <Boom error={err} />
        </HomeErrorBoundary>
      </Wrapper>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-home-error-variant")).toBe("server");
    expect(screen.getByRole("link", { name: /contact support/i })).toBeTruthy();
  });

  it("renders the offline variant when navigator is offline", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <HomeErrorBoundary>
          <Boom error={new Error("net err")} />
        </HomeErrorBoundary>
      </Wrapper>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-home-error-variant")).toBe("offline");
    if (original) Object.defineProperty(navigator, "onLine", original);
    else delete (navigator as { onLine?: boolean }).onLine;
  });

  it("fires telemetry when caught with the requestId and variant", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.documentElement.dataset.requestId = "rid-abc-1234";
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <HomeErrorBoundary>
          <Boom error={new MediaApiError(500, { code: "home.internal" })} />
        </HomeErrorBoundary>
      </Wrapper>,
    );
    const homeCall = reportSpy.mock.calls.find((c) => c[3] === "client.home.boundary");
    expect(homeCall).toBeTruthy();
    const [, severity, context, code] = homeCall!;
    expect(severity).toBe("warning");
    expect(context).toMatchObject({ variant: "server", requestId: "rid-abc-1234" });
    expect(code).toBe("client.home.boundary");
    delete document.documentElement.dataset.requestId;
  });

  it("does not double-fire telemetry from the base ErrorBoundary when a custom fallback is set", () => {
    // The shared `componentDidCatch` would otherwise emit a generic "error"
    // event in addition to the variant-aware "warning" event from
    // FallbackInner. The base boundary skips when a fallback is provided so
    // feature boundaries own their telemetry path.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <HomeErrorBoundary>
          <Boom error={new MediaApiError(500, { code: "home.internal" })} />
        </HomeErrorBoundary>
      </Wrapper>,
    );
    expect(reportSpy.mock.calls).toHaveLength(1);
    expect(reportSpy.mock.calls[0]?.[1]).toBe("warning");
  });

  it("hides the alert and shows the home skeleton during the retry transition", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(homeKeys.layout(), { sentinel: true });
    const resetSpy = vi.spyOn(client, "resetQueries");
    const Wrapper = wrap(client);
    const { container } = render(
      <Wrapper>
        <HomeErrorBoundary>
          <Boom error={new Error("kaboom")} />
        </HomeErrorBoundary>
      </Wrapper>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });
    expect(resetSpy).toHaveBeenCalledWith({ queryKey: homeKeys.all });
    // The boundary swaps the inert fallback for the home skeleton synchronously
    // so the page never flashes empty before suspense re-suspends on the retry.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    await waitFor(() => {
      // After resetQueries resolves the boundary clears, the child re-throws,
      // and the alert returns. We just want the test to settle without warnings.
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });
});
