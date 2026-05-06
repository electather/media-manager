// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MediaDetailModal, type MediaDetailItem } from "..";

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
  seasons: [
    { number: 1, episodeCount: 8, counts: { available: 8 }, episodes: [] },
    { number: 2, episodeCount: 6, counts: { unavailable: 6 }, episodes: [] },
    { number: 3, episodeCount: 4, counts: { upcoming: 4 }, episodes: [] },
  ],
};

describe("MediaDetailModal", () => {
  it("does not render the modal content when closed", () => {
    render(
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
    render(
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
    render(
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
    render(
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

    const { rerender } = render(
      <MediaDetailModal
        item={MOVIE}
        open
        onClose={vi.fn()}
        inWatchlist={false}
        onToggleWatchlist={vi.fn()}
      />,
    );
    rerender(
      <MediaDetailModal
        item={MOVIE}
        open={false}
        onClose={vi.fn()}
        inWatchlist={false}
        onToggleWatchlist={vi.fn()}
      />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("opens the request picker and surfaces a pending status after submit", () => {
    render(
      <MediaDetailModal
        item={MOVIE}
        open
        onClose={vi.fn()}
        inWatchlist={false}
        onToggleWatchlist={vi.fn()}
      />,
    );
    const requestBtn = screen.getByRole("button", { name: /^request$/i });
    fireEvent.click(requestBtn);
    // The picker's submit button reuses the picker title ("Request movie").
    const submitBtn = screen.getByRole("button", { name: /^request movie$/i });
    fireEvent.click(submitBtn);
    // Default `user` role needs admin approval, so the pending label renders.
    expect(screen.getByText(/awaiting approval/i)).toBeTruthy();
  });

  it("renders the season accordion for TV items only", () => {
    const { rerender } = render(
      <MediaDetailModal
        item={MOVIE}
        open
        onClose={vi.fn()}
        inWatchlist={false}
        onToggleWatchlist={vi.fn()}
      />,
    );
    expect(screen.queryByRole("region", { name: /seasons/i })).toBeNull();

    rerender(
      <MediaDetailModal
        item={TV}
        open
        onClose={vi.fn()}
        inWatchlist={false}
        onToggleWatchlist={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: /seasons/i })).toBeTruthy();
    const seasonHeaders = screen.getAllByText(/^Season \d+$/);
    expect(seasonHeaders.length).toBe(TV.episode!.season);
  });
});
