// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    fireEvent.click(moreInfo);
    expect(onPeek).toHaveBeenCalledWith(HERO.id);
  });

  it("ambient layer is aria-hidden so it cannot trap focus", () => {
    render(<TopZone hero={HERO} onPeek={vi.fn()} />);
    const ambient = screen.getByTestId("top-zone-ambient");
    expect(ambient.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not clip the ambient glow so the bleed fades naturally on every side", () => {
    render(<TopZone hero={HERO} onPeek={vi.fn()} />);
    const stage = screen.getByTestId("top-zone");
    expect(stage.className).not.toContain("overflow-x-clip");
    expect(stage.className).not.toContain("overflow-hidden");
  });

  it("lets the ambient glow fade vertically without boxing the hero", () => {
    render(<TopZone hero={HERO} onPeek={vi.fn()} />);
    const ambient = screen.getByTestId("top-zone-ambient");
    expect(ambient.className).toContain("inset-y-[-18%]");
    expect(ambient.className).not.toContain("overflow-hidden");
    expect(ambient.firstElementChild?.className).toContain("[mask-image:radial-gradient");
  });

  it("uses a Safari-safe clip path for the rounded hero artwork", () => {
    render(<TopZone hero={HERO} onPeek={vi.fn()} />);
    const frame = screen.getByTestId("top-zone-hero-frame");
    expect(frame.className).toContain("[clip-path:inset(0_round_var(--radius-4xl))]");
  });

  it("clicking an alternate dot updates the hero card title and More Info target", () => {
    const onPeek = vi.fn();
    render(<TopZone hero={HERO} onPeek={onPeek} />);
    const altsNav = screen.getByTestId("top-zone-alternates");
    const dots = within(altsNav).getAllByRole("button");

    fireEvent.click(dots[1]!);
    const updatedDots = within(screen.getByTestId("top-zone-alternates")).getAllByRole("button");
    expect(updatedDots[1]!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { level: 1, name: "Alt 1" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /more info/i }));
    expect(onPeek).toHaveBeenCalledWith(HERO.alternates[0]!.id);
  });
});
