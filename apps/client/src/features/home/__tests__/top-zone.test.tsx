// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { HeroItem } from "../lib/types";
import { TopZone } from "../components/top-zone";

afterEach(() => {
  cleanup();
});

const HERO: HeroItem = {
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
  alternates: [
    {
      id: "movie:alt-1",
      tmdbId: "alt-1",
      mediaType: "movie",
      title: "Alt 1",
    },
    {
      id: "movie:alt-2",
      tmdbId: "alt-2",
      mediaType: "movie",
      title: "Alt 2",
    },
  ],
};

describe("TopZone", () => {
  it("renders the hero title, year, and rating", () => {
    render(<TopZone hero={HERO} onPeek={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: HERO.title })).toBeTruthy();
    expect(screen.getByText("2024")).toBeTruthy();
    expect(screen.getByText("8.4")).toBeTruthy();
  });

  it("renders one alternate switcher per candidate (hero + alternates)", () => {
    render(<TopZone hero={HERO} onPeek={vi.fn()} />);
    const altsNav = screen.getByTestId("top-zone-alternates");
    const buttons = within(altsNav).getAllByRole("button");
    expect(buttons).toHaveLength(HERO.alternates.length + 1);
  });

  it("calls onPeek with the hero id when More Info is clicked", () => {
    const onPeek = vi.fn();
    render(<TopZone hero={HERO} onPeek={onPeek} />);
    const moreInfo = screen.getByRole("button", { name: /more info/i });
    moreInfo.click();
    expect(onPeek).toHaveBeenCalledWith(HERO.id);
  });

  it("ambient layer is aria-hidden so it cannot trap focus", () => {
    render(<TopZone hero={HERO} onPeek={vi.fn()} />);
    const ambient = screen.getByTestId("top-zone-ambient");
    expect(ambient.getAttribute("aria-hidden")).toBe("true");
  });
});
