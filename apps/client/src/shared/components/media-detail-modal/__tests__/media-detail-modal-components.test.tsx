// @vitest-environment happy-dom
import { useRef, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ModalFeedback } from "../modal-feedback";
import { ModalMatchReason } from "../modal-match-reason";
import { ModalNote } from "../modal-note";
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
    expect(screen.getByText(/^\(500\)$/)).toBeTruthy();
    expect(screen.queryByText(/0\.5K/i)).toBeNull();
  });

  it("uses compact notation in parens for thousands+", () => {
    render(<ModalScores item={{ ...BASE_MOVIE, rating: 8.4, votes: 12500 }} />);
    expect(screen.getByText(/^\((?:12K|13K|12\.5K)\)$/)).toBeTruthy();
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
            { number: 1, episodeCount: 6, counts: { available: 6 }, episodes: [] },
            { number: 2, episodeCount: 4, counts: { unavailable: 4 }, episodes: [] },
          ],
        }}
      />,
    );
    expect(screen.getByText("6 episodes")).toBeTruthy();
    expect(screen.getByText("4 episodes")).toBeTruthy();
  });

  // Regression: prior `available > 0 && available < episodeCount - upcoming`
  // misclassified seasons where some episodes are aired+available but the
  // remainder is upcoming (e.g. 3 available + 2 upcoming) as fully
  // unavailable. The corrected predicate keeps them in "partial".
  it("classifies a mixed-available-and-upcoming season as partial", () => {
    render(
      <ModalSeasons
        item={{
          ...BASE_TV,
          seasons: [
            {
              number: 1,
              episodeCount: 5,
              counts: { available: 3, upcoming: 2 },
              episodes: [],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/3 of 5 available/)).toBeTruthy();
    expect(screen.getByText(/2 upcoming/)).toBeTruthy();
  });
});

describe("ModalFeedback", () => {
  it("toggles a single active vote (like/dislike are mutually exclusive)", () => {
    render(<ModalFeedback hasNote={false} onNoteClick={vi.fn()} />);
    const like = screen.getByRole("button", { name: /^like$/i });
    const dislike = screen.getByRole("button", { name: /^dislike$/i });
    expect(like.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(like);
    expect(like.getAttribute("aria-pressed")).toBe("true");
    expect(dislike.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(dislike);
    expect(like.getAttribute("aria-pressed")).toBe("false");
    expect(dislike.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(dislike);
    expect(dislike.getAttribute("aria-pressed")).toBe("false");
  });

  it("invokes onNoteClick when the note pill is clicked", () => {
    const onNoteClick = vi.fn();
    render(<ModalFeedback hasNote={false} onNoteClick={onNoteClick} />);
    fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
    expect(onNoteClick).toHaveBeenCalledOnce();
  });

  it("switches the note pill label when a note is present", () => {
    render(<ModalFeedback hasNote onNoteClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: /edit your note/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add a note/i })).toBeNull();
  });
});

describe("ModalNote", () => {
  function ControlledNote({
    initial = "",
    initialEditing = true,
  }: {
    initial?: string;
    initialEditing?: boolean;
  }) {
    const [note, setNote] = useState(initial);
    const [editing, setEditing] = useState(initialEditing);
    const sectionRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    return (
      <ModalNote
        sectionRef={sectionRef}
        taRef={taRef}
        note={note}
        editing={editing}
        setEditing={setEditing}
        onSave={setNote}
      />
    );
  }

  it("saves the trimmed draft and closes editing", () => {
    render(<ControlledNote />);
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "  watch with my dad  " } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));
    expect(screen.getByText("watch with my dad")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("cancels back to the persisted note without overwriting it", () => {
    render(<ControlledNote initial="original note" />);
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "scrap draft" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByText("original note")).toBeTruthy();
    expect(screen.queryByText("scrap draft")).toBeNull();
  });

  it("re-enters editing mode from the existing-note view", () => {
    render(<ControlledNote initial="original note" initialEditing={false} />);
    fireEvent.click(screen.getByRole("button", { name: /edit your note/i }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
