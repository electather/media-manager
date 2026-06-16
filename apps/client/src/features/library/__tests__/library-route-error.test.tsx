// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { mediaKeys } from "@/shared/media/query-keys";
import { libraryKeys } from "../lib/query-keys";
import { LibraryRouteError } from "../components/library-route-error";

afterEach(cleanup);

describe("LibraryRouteError", () => {
  // The route-level errorComponent is what the user sees when a lens loader's
  // prefetch rejects (the page never mounts, so no inner ErrorBoundary fires).
  it("renders the library fallback with a localized body and a retry control", () => {
    const client = new QueryClient();
    const reset = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <LibraryRouteError error={new Error("prefetch boom")} reset={reset} />
      </QueryClientProvider>,
    );

    // getByText / getByRole throw if absent, so a successful query is the
    // assertion (repo style — no jest-dom matchers).
    expect(screen.getByText(m.library_load_error_title())).toBeTruthy();
    expect(screen.getByText(m.errors_default_body())).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  // The raw error message is a server-shipped English diagnostic (or arbitrary
  // thrown text) — rendering it leaks internal detail and is un-localized for a
  // non-English user, so the fallback must never surface it.
  it("does not render the raw error message", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <LibraryRouteError error={new Error("prefetch boom")} reset={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.queryByText("prefetch boom")).toBeNull();
  });

  // The four item lenses ride the shared media source under `mediaKeys`, not
  // `libraryKeys`; resetting only `libraryKeys.all` (collections + facets) would
  // leave a failed lens read cached, so retry would appear to do nothing. The
  // fallback must reset both families.
  it("resets both the library and the media-source query families on retry", () => {
    const client = new QueryClient();
    const resetQueries = vi.spyOn(client, "resetQueries").mockResolvedValue(undefined);
    const reset = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <LibraryRouteError error={new Error("boom")} reset={reset} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(resetQueries).toHaveBeenCalledWith({ queryKey: libraryKeys.all });
    expect(resetQueries).toHaveBeenCalledWith({ queryKey: mediaKeys.root });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
