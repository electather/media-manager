// @vitest-environment happy-dom
import { useRef, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
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

  it("renders typed match-reason copy via the Paraglide map", () => {
    render(<ModalMatchReason reason={{ key: "from_active_series", params: {} }} />);
    expect(screen.getByText(/active/i)).toBeTruthy();
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
  it("renders nothing for movie titles", () => {
    const { container } = render(<ModalSeasons item={BASE_MOVIE} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for TV titles missing the canonical season list", () => {
    const { container } = render(<ModalSeasons item={BASE_TV} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("ModalFeedback", () => {
  it("renders like/dislike vote buttons as aria-disabled (persistence not yet wired)", () => {
    render(<ModalFeedback hasNote={false} />);
    const like = screen.getByRole("button", { name: /^like$/i });
    const dislike = screen.getByRole("button", { name: /^dislike$/i });
    // Buttons must use aria-disabled so keyboard/screen-reader users can discover
    // them while still being announced as unavailable until vote persistence lands.
    expect(like.getAttribute("aria-disabled")).toBe("true");
    expect(dislike.getAttribute("aria-disabled")).toBe("true");
    // The buttons must NOT carry the HTML disabled attribute — that removes them
    // from the tab order entirely, hiding them from assistive technology.
    expect((like as HTMLButtonElement).disabled).toBe(false);
    expect((dislike as HTMLButtonElement).disabled).toBe(false);
    expect(like.getAttribute("aria-pressed")).toBe("false");
    expect(dislike.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders note pill as aria-disabled (persistence not yet wired)", () => {
    render(<ModalFeedback hasNote={false} />);
    const noteBtn = screen.getByRole("button", { name: /add a note/i });
    // The note button uses aria-disabled to stay in the tab order while being
    // announced as unavailable until note persistence is implemented.
    expect(noteBtn.getAttribute("aria-disabled")).toBe("true");
    expect((noteBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("switches the note pill label when a note is present", () => {
    render(<ModalFeedback hasNote />);
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
