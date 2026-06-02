// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LibraryRouteError } from "../components/library-route-error";

afterEach(cleanup);

describe("LibraryRouteError", () => {
  // The route-level errorComponent is what the user sees when a lens loader's
  // prefetch rejects (the page never mounts, so no inner ErrorBoundary fires).
  it("renders the library fallback with the error message and a retry control", () => {
    const client = new QueryClient();
    const reset = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <LibraryRouteError error={new Error("prefetch boom")} reset={reset} />
      </QueryClientProvider>,
    );

    // getByText / getByRole throw if absent, so a successful query is the
    // assertion (repo style — no jest-dom matchers).
    expect(screen.getByText("prefetch boom")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
