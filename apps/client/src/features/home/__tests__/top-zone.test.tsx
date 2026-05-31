// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { HeroSlideUI } from "../lib/types";
import { TopZone } from "../components/top-zone";

afterEach(() => {
  cleanup();
});

const SLIDES: HeroSlideUI[] = [
  {
    id: "movie:hero-1",
    tmdbId: "hero-1",
    mediaType: "movie",
    title: "Aurora Drift",
    year: 2024,
    runtime: "2h 14m",
    ageRating: "PG-13",
    rating: 8.4,
    genres: ["Sci-Fi", "Drama"],
    overview: "An atmospheric sci-fi descent.",
    backdrop: "https://example.test/bg.jpg",
    clearLogoText: "AURORA·DRIFT",
    source: "continueWatching",
    reason: "continue_watching",
    resumeUrl: null,
  },
  {
    id: "movie:alt-1",
    tmdbId: "alt-1",
    mediaType: "movie",
    title: "Alt 1",
    poster: "https://example.test/alt-1.jpg",
    source: "recommendedForYou",
    reason: "recommended",
    resumeUrl: null,
  },
  {
    id: "movie:alt-2",
    tmdbId: "alt-2",
    mediaType: "movie",
    title: "Alt 2",
    poster: "https://example.test/alt-2.jpg",
    source: "trendingNow",
    reason: "trending",
    resumeUrl: null,
  },
];

function ambientImages(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLImageElement>('[data-testid="top-zone-ambient"] img'),
  );
}

describe("TopZone", () => {
  it("renders the hero title, year, and rating", () => {
    render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: SLIDES[0]!.title })).toBeTruthy();
    expect(screen.getByText("2024")).toBeTruthy();
    expect(screen.getByText("8.4")).toBeTruthy();
  });

  it("renders one non-interactive position indicator per slide", () => {
    render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    const indicator = screen.getByTestId("top-zone-alternates");
    expect(indicator.querySelectorAll("span")).toHaveLength(SLIDES.length);
    // Informative only — the dots report which slide is active, they are not
    // controls: no buttons, links, or focusable elements.
    expect(within(indicator).queryAllByRole("button")).toHaveLength(0);
    expect(indicator.querySelector("button, a, [tabindex]")).toBeNull();
    expect(indicator.querySelector('[aria-current="true"]')).toBeTruthy();
  });

  it("calls onPeek with the active slide id when More Info is clicked", () => {
    const onPeek = vi.fn();
    render(<TopZone slides={SLIDES} onPeek={onPeek} />);
    const moreInfo = screen.getByRole("button", { name: /more info/i });
    fireEvent.click(moreInfo);
    expect(onPeek).toHaveBeenCalledWith(SLIDES[0]!.id);
  });

  it("ambient layer is aria-hidden so it cannot trap focus", () => {
    render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    const ambient = screen.getByTestId("top-zone-ambient");
    expect(ambient.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not clip the ambient glow so the bleed fades naturally on every side", () => {
    render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    const stage = screen.getByTestId("top-zone");
    expect(stage.className).not.toContain("overflow-x-clip");
    expect(stage.className).not.toContain("overflow-hidden");
  });

  it("lets the ambient glow extend past the hero into the rows below", () => {
    render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    const ambient = screen.getByTestId("top-zone-ambient");
    expect(ambient.className).toContain("-bottom-32");
    expect(ambient.className).toContain("-top-10");
    expect(ambient.className).not.toContain("overflow-hidden");
  });

  it("V66 fades the previous ambient image while the next ambient image fades in", async () => {
    const { container } = render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    await waitFor(() => expect(ambientImages(container)).toHaveLength(1));

    // Dots are not clickable; advancing the slide (dismiss) drives the fade.
    fireEvent.click(screen.getByRole("button", { name: /not tonight/i }));

    await waitFor(() => expect(ambientImages(container)).toHaveLength(2));
    const [outgoing, incoming] = ambientImages(container);
    expect(outgoing!.src).toContain("bg.jpg");
    expect(Array.from(outgoing!.classList)).toContain("opacity-0");
    expect(incoming!.src).toContain("alt-1.jpg");
    expect(Array.from(incoming!.classList)).toContain("opacity-60");
  });

  it("uses a Safari-safe clip path for the rounded hero artwork", () => {
    render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    const frame = screen.getByTestId("top-zone-hero-frame");
    expect(frame.className).toContain("[clip-path:inset(0_round_var(--radius-4xl))]");
  });

  it("marks the active dot and retargets the hero as the slide advances", () => {
    const onPeek = vi.fn();
    render(<TopZone slides={SLIDES} onPeek={onPeek} />);

    // Dots are informative, not jump targets — the slide advances via dismiss.
    fireEvent.click(screen.getByRole("button", { name: /not tonight/i }));

    const dots = screen.getByTestId("top-zone-alternates").querySelectorAll("span");
    expect(dots[1]!.getAttribute("aria-current")).toBe("true");
    expect(dots[0]!.getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Alt 1" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /more info/i }));
    expect(onPeek).toHaveBeenCalledWith(SLIDES[1]!.id);
  });

  it("renders the per-slide source label and updates it when the active slide changes", () => {
    render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    expect(screen.getByTestId("top-zone-source-label").textContent).toBe(
      "Pick up where you left off",
    );

    fireEvent.click(screen.getByRole("button", { name: /not tonight/i }));
    expect(screen.getByTestId("top-zone-source-label").textContent).toBe("Recommended for you");

    fireEvent.click(screen.getByRole("button", { name: /not tonight/i }));
    expect(screen.getByTestId("top-zone-source-label").textContent).toBe("Trending now");
  });

  it("preserves the active slide when the parent re-renders with a new slides array of the same content", () => {
    // Regression: pressing More Info adds `?peek=<id>` which re-renders the
    // parent and produces a new `slides` array reference. The selected slide
    // must persist — previously a `useEffect([slides])` reset it to index 0.
    const { rerender } = render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /not tonight/i }));
    expect(screen.getByRole("heading", { level: 1, name: "Alt 1" })).toBeTruthy();

    rerender(<TopZone slides={SLIDES.map((s) => ({ ...s }))} onPeek={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Alt 1" })).toBeTruthy();
  });

  it("resets to the first slide when the upstream slides content actually changes", () => {
    const { rerender } = render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /not tonight/i }));
    expect(screen.getByRole("heading", { level: 1, name: "Alt 1" })).toBeTruthy();

    const swapped: HeroSlideUI[] = [
      { ...SLIDES[0]!, id: "movie:hero-2", title: "Different Hero" },
      SLIDES[1]!,
    ];
    rerender(<TopZone slides={swapped} onPeek={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Different Hero" })).toBeTruthy();
  });

  it("hides the duplicate movie title visually when the clear logo carries it, keeping the heading for screen readers", () => {
    render(<TopZone slides={SLIDES} onPeek={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1, name: SLIDES[0]!.title });
    expect(heading.className).toContain("sr-only");
  });

  it("keeps the title visible for movies that have no clear logo or logo text", () => {
    const slide: HeroSlideUI = {
      ...SLIDES[0]!,
      title: "Plain Title",
      clearLogo: undefined,
      clearLogoText: undefined,
    };
    render(<TopZone slides={[slide]} onPeek={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Plain Title" });
    expect(heading.className).not.toContain("sr-only");
  });

  it("keeps the heading visible for TV shows even when a clear logo is present", () => {
    const slide: HeroSlideUI = {
      ...SLIDES[0]!,
      mediaType: "tv",
      title: "Show Title",
      clearLogoText: "SHOW·LOGO",
    };
    render(<TopZone slides={[slide]} onPeek={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Show Title" });
    expect(heading.className).not.toContain("sr-only");
  });

  it("renders the active slide availability pill in the hero frame top right", () => {
    render(
      <TopZone
        slides={[
          {
            ...SLIDES[0]!,
            availability: {
              hasAnyServerCopy: true,
              requestEligible: false,
              servers: [{ id: "plex", label: "Plex" }],
            },
          },
        ]}
        onPeek={vi.fn()}
      />,
    );

    const pill = screen.getByText("Plex").closest("span");
    expect(pill).toBeTruthy();
    expect(screen.getByTestId("top-zone-hero-frame").contains(pill)).toBe(true);
    expect(pill!.className).toContain("absolute");
    expect(pill!.className).toContain("top-4");
    expect(pill!.className).toContain("inset-e-4");
    expect(pill!.className).toContain("rounded-full");
    expect(pill!.className).toContain("gap-1");
    expect(pill!.className).toContain("border-success/40");
    expect(pill!.querySelector("svg")).toBeTruthy();
  });
});
