// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { MediaApiError } from "@/shared/media/error";
import { mediaKeys } from "@/shared/media/query-keys";
import { libraryKeys } from "../lib/query-keys";
import { LibraryApiError } from "../lib/types";
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

  // The body is keyed off the typed `LibraryApiError.status`, so a known status
  // gets specific localized copy instead of the generic body. A leaked English
  // `devMessage` in the error body must still never surface.
  it("renders status-specific localized copy for a typed LibraryApiError", () => {
    const client = new QueryClient();
    const error = new LibraryApiError(404, { devMessage: "row not found in catalog table" });
    render(
      <QueryClientProvider client={client}>
        <LibraryRouteError error={error} reset={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.getByText(m.errors_not_found_body())).toBeTruthy();
    expect(screen.queryByText(m.errors_default_body())).toBeNull();
    expect(screen.queryByText(/row not found in catalog table/)).toBeNull();
  });

  it.each([
    [401, "errors_unauthorized_body", () => m.errors_unauthorized_body()],
    [429, "errors_rate_limited_body", () => m.errors_rate_limited_body()],
    [503, "errors_maintenance_body", () => m.errors_maintenance_body()],
    [500, "errors_server_body", () => m.errors_server_body()],
    [502, "errors_server_body (other 5xx)", () => m.errors_server_body()],
  ])("renders %s → %s for LibraryApiError", (status, _label, expected) => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <LibraryRouteError error={new LibraryApiError(status, null)} reset={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(expected())).toBeTruthy();
  });

  it("renders errors_default_body for LibraryApiError 403 (forbidden, not session-expired)", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <LibraryRouteError error={new LibraryApiError(403, null)} reset={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(m.errors_default_body())).toBeTruthy();
  });

  // Lens routes (timeline/quality/server/default) throw MediaApiError via
  // defineMediaSource, not LibraryApiError. The fallback must handle both.
  it("renders status-specific copy for a MediaApiError from a lens route", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <LibraryRouteError error={new MediaApiError(404, null)} reset={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(m.errors_not_found_body())).toBeTruthy();
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
