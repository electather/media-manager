// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { HomeErrorBoundary } from "../lib/error-boundary";
import { HomeApiError } from "../lib/types";
import { homeKeys } from "../lib/query-keys";

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
});

describe("HomeErrorBoundary", () => {
  it("renders the fallback with the typed error message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = wrap(client);
    const err = new HomeApiError(503, { message: "service unavailable" });
    render(
      <Wrapper>
        <HomeErrorBoundary>
          <Boom error={err} />
        </HomeErrorBoundary>
      </Wrapper>,
    );
    expect(screen.getByText("service unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("resets feature-scoped queries on retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(homeKeys.layout(), { sentinel: true });
    const resetSpy = vi.spyOn(client, "resetQueries");
    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <HomeErrorBoundary>
          <Boom error={new Error("kaboom")} />
        </HomeErrorBoundary>
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(resetSpy).toHaveBeenCalledWith({ queryKey: homeKeys.all });
  });
});
