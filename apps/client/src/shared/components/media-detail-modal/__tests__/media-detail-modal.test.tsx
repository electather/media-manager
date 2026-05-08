// @vitest-environment happy-dom
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MediaDetailModal, type MediaDetailItem } from "..";

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
});

const MOVIE: MediaDetailItem = {
  id: "movie:detail-1",
  tmdbId: "detail-1",
  mediaType: "movie",
  title: "Aurora Drift",
  year: 2024,
  rating: 8.4,
  overview: "An atmospheric sci-fi descent.",
  director: "Yusuf Okafor",
  cast: ["Mara Holloway", "Eitan Vasquez"],
  clearLogoText: "AURORA·DRIFT",
};

const TV: MediaDetailItem = {
  id: "tv:detail-1",
  tmdbId: "detail-1",
  mediaType: "tv",
  title: "Long Wave",
  year: 2024,
  rating: 8.1,
  overview: "Rolling, slow-burn anthology.",
  episode: { season: 3, episode: 1, airsAt: 0 },
};

describe("MediaDetailModal", () => {
  it("does not render the modal content when closed", () => {
    renderWithClient(
      <MediaDetailModal
        item={null}
        open={false}
        onClose={vi.fn()}
        inWatchlist={false}
        onToggleWatchlist={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("media-detail-modal")).toBeNull();
  });

  it("renders dialog with role + aria-modal and labelled by the title", () => {
    renderWithClient(
      <MediaDetailModal
        item={MOVIE}
        open
        onClose={vi.fn()}
        inWatchlist={false}
        onToggleWatchlist={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe(MOVIE.clearLogoText);
  });

  it("Escape key closes the modal", () => {
    const onClose = vi.fn();
    renderWithClient(
      <MediaDetailModal
        item={MOVIE}
        open
        onClose={onClose}
        inWatchlist={false}
        onToggleWatchlist={vi.fn()}
      />,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("toggles watchlist when the watchlist button is clicked", () => {
    const onToggle = vi.fn();
    renderWithClient(
      <MediaDetailModal
        item={MOVIE}
        open
        onClose={vi.fn()}
        inWatchlist={false}
        onToggleWatchlist={onToggle}
      />,
    );
    const watchlistBtn = screen.getByRole("button", { name: /add to watchlist/i });
    expect(watchlistBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(watchlistBtn);
    expect(onToggle).toHaveBeenCalled();
  });

  it("returns focus to the trigger element when closed", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MediaDetailModal
          item={MOVIE}
          open
          onClose={vi.fn()}
          inWatchlist={false}
          onToggleWatchlist={vi.fn()}
        />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={client}>
        <MediaDetailModal
          item={MOVIE}
          open={false}
          onClose={vi.fn()}
          inWatchlist={false}
          onToggleWatchlist={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("hides the seasons section for movies and for TV items missing seasons[]", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MediaDetailModal
          item={MOVIE}
          open
          onClose={vi.fn()}
          inWatchlist={false}
          onToggleWatchlist={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("region", { name: /seasons/i })).toBeNull();

    rerender(
      <QueryClientProvider client={client}>
        <MediaDetailModal
          item={TV}
          open
          onClose={vi.fn()}
          inWatchlist={false}
          onToggleWatchlist={vi.fn()}
        />
      </QueryClientProvider>,
    );
    // TV item has no canonical seasons[] payload — section stays hidden until
    // home.getDetails populates it.
    expect(screen.queryByRole("region", { name: /seasons/i })).toBeNull();
  });
});
