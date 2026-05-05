// @vitest-environment happy-dom
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ModalMatchReason } from "../modal-match-reason";
import { ModalScores } from "../modal-scores";
import { ModalSeasons } from "../modal-seasons";
import { ModalTags } from "../modal-tags";
import { ModalTopbar } from "../modal-topbar";
import type { MediaDetailItem } from "../types";

const BASE_TV: MediaDetailItem = {
  id: "tv:1",
  tmdbId: "tv-1",
  mediaType: "tv",
  title: "Long Wave",
  year: 2024,
  episode: { season: 2, episode: 1, airsAt: 0 },
};

const BASE_MOVIE: MediaDetailItem = {
  id: "movie:1",
  tmdbId: "movie-1",
  mediaType: "movie",
  title: "Aurora Drift",
  year: 2024,
};

afterEach(() => {
  cleanup();
});

describe("ModalScores", () => {
  it("renders nothing when no scoring fields are present", () => {
    const { container } = render(<ModalScores item={BASE_MOVIE} />);
    expect(container.firstChild).toBeNull();
  });

  it("formats sub-thousand vote counts without misleading 0.x suffix", () => {
    render(<ModalScores item={{ ...BASE_MOVIE, rating: 8.4, votes: 500 }} />);
    expect(screen.getByText(/· 500 votes/)).toBeTruthy();
    expect(screen.queryByText(/0\.5K votes/i)).toBeNull();
  });

  it("uses compact notation for thousands+", () => {
    render(<ModalScores item={{ ...BASE_MOVIE, rating: 8.4, votes: 12500 }} />);
    expect(screen.getByText(/· 12K votes|· 13K votes|· 12\.5K votes/)).toBeTruthy();
  });
});

describe("ModalTags", () => {
  it("returns null when tags are missing", () => {
    const { container } = render(<ModalTags item={BASE_MOVIE} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each tag provided", () => {
    render(<ModalTags item={{ ...BASE_MOVIE, tags: ["4K", "HDR", "Atmos"] }} />);
    expect(screen.getByText("4K")).toBeTruthy();
    expect(screen.getByText("HDR")).toBeTruthy();
    expect(screen.getByText("Atmos")).toBeTruthy();
  });
});

describe("ModalMatchReason", () => {
  it("returns null when reason is missing", () => {
    const { container } = render(<ModalMatchReason reason={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the reason text", () => {
    render(<ModalMatchReason reason="From a show you are actively watching." />);
    expect(screen.getByText(/From a show you are actively watching\./)).toBeTruthy();
  });
});

describe("ModalTopbar", () => {
  function renderTopbar(item: MediaDetailItem) {
    return render(
      <BaseDialog.Root open>
        <BaseDialog.Portal>
          <BaseDialog.Popup>
            <ModalTopbar item={item} />
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>,
    );
  }

  it("shows the Movie kind badge for movie items", () => {
    renderTopbar(BASE_MOVIE);
    expect(screen.getByText(/^Movie$/)).toBeTruthy();
  });

  it("shows the TV kind badge for tv items", () => {
    renderTopbar(BASE_TV);
    expect(screen.getByText(/^TV series$/)).toBeTruthy();
  });

  it("renders the close button with an accessible label", () => {
    renderTopbar(BASE_MOVIE);
    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();
  });
});

describe("ModalSeasons", () => {
  // Regression: previously fabricated episode counts (8, 10, 9, 8, 10 …) for
  // every season — a misleading "X episodes" subtitle and matching list of
  // fake episode rows. With no real season data, neither should appear.
  it("does not fabricate episode counts when seasons data is missing", () => {
    render(<ModalSeasons item={BASE_TV} />);
    expect(screen.queryByText(/\d+ episodes/)).toBeNull();
    expect(screen.queryByText(/^Episode \d+$/)).toBeNull();
  });

  it("renders real episode counts when seasons data is provided", () => {
    render(
      <ModalSeasons
        item={{
          ...BASE_TV,
          seasons: [
            { number: 1, episodeCount: 6 },
            { number: 2, episodeCount: 4 },
          ],
        }}
      />,
    );
    expect(screen.getByText("6 episodes")).toBeTruthy();
    expect(screen.getByText("4 episodes")).toBeTruthy();
  });
});
