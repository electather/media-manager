// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: () => ({ data: undefined }),
  EMPTY_BUNDLE: { poster: [], backdrop: [], clearLogo: [], thumb: [] },
}));

import { RowCarousel } from "../row-carousel";

const items: CompactMediaItem[] = [
  { id: "movie:1", tmdbId: "1", mediaType: "movie", title: "One", poster: "a.jpg" },
  { id: "movie:2", tmdbId: "2", mediaType: "movie", title: "Two", poster: "b.jpg" },
  { id: "movie:3", tmdbId: "3", mediaType: "movie", title: "Three", poster: "c.jpg" },
];

afterEach(() => cleanup());

describe("RowCarousel slide width (V30)", () => {
  it("reads aspect from ROW_DISPLAY for backdrop rows, not from item shape", () => {
    // `continueWatching` is declared as backdrop in ROW_DISPLAY. Items here
    // carry neither `progress` nor `episode`, so a per-item check would
    // misclassify them as poster.
    const { container } = render(
      <RowCarousel
        rowId="continueWatching"
        items={items}
        hasMore={false}
        isFetching={false}
        onNearEnd={() => {}}
      />,
    );
    // Only inspect the slide wrappers; the inner Card link also stamps
    // `data-aspect`, but the carousel-level decision is what V30 covers.
    const slides = container.querySelectorAll("div.shrink-0[data-aspect]");
    expect(slides.length).toBe(items.length);
    slides.forEach((slide) => expect(slide.getAttribute("data-aspect")).toBe("backdrop"));
  });

  it("emits no data-aspect attribute on slide wrappers for poster rows", () => {
    // `trendingNow` is poster — slide wrappers should not stamp `data-aspect`.
    const { container } = render(
      <RowCarousel
        rowId="trendingNow"
        items={items}
        hasMore={false}
        isFetching={false}
        onNearEnd={() => {}}
      />,
    );
    expect(container.querySelectorAll("div.shrink-0[data-aspect]").length).toBe(0);
  });

  it("renders the loading skeleton with backdrop sizing for backdrop rows", () => {
    const { container } = render(
      <RowCarousel
        rowId="continueWatching"
        items={items}
        hasMore={true}
        isFetching={true}
        onNearEnd={() => {}}
      />,
    );
    // Skeleton slide is the only slide that does not contain a Card link.
    const slides = Array.from(container.querySelectorAll<HTMLDivElement>("div.shrink-0"));
    const skeletonSlide = slides.find((s) => !s.querySelector("a[data-card-link]"));
    expect(skeletonSlide).toBeDefined();
    expect(skeletonSlide!.getAttribute("data-aspect")).toBe("backdrop");
    const inner = skeletonSlide!.firstElementChild as HTMLElement;
    expect(inner.className).toContain("aspect-video");
    expect(inner.className).not.toContain("aspect-[2/3]");
  });

  it("renders the loading skeleton with poster sizing for poster rows", () => {
    const { container } = render(
      <RowCarousel
        rowId="trendingNow"
        items={items}
        hasMore={true}
        isFetching={true}
        onNearEnd={() => {}}
      />,
    );
    const slides = Array.from(container.querySelectorAll<HTMLDivElement>("div.shrink-0"));
    const skeletonSlide = slides.find((s) => !s.querySelector("a[data-card-link]"));
    expect(skeletonSlide).toBeDefined();
    expect(skeletonSlide!.hasAttribute("data-aspect")).toBe(false);
    const inner = skeletonSlide!.firstElementChild as HTMLElement;
    expect(inner.className).toContain("aspect-[2/3]");
  });
});

describe("RowCarousel arrow accessibility (T23)", () => {
  it("exposes aria-label on both arrows without aria-hidden masking it", () => {
    render(
      <RowCarousel
        rowId="trendingNow"
        items={items}
        hasMore={false}
        isFetching={false}
        onNearEnd={() => {}}
      />,
    );
    const left = screen.getByRole("button", { name: "Scroll left" });
    const right = screen.getByRole("button", { name: "Scroll right" });
    expect(left.hasAttribute("aria-hidden")).toBe(false);
    expect(right.hasAttribute("aria-hidden")).toBe(false);
    expect(left.getAttribute("tabindex")).toBe("-1");
    expect(right.getAttribute("tabindex")).toBe("-1");
  });
});

describe("RowCarousel keyboard navigation (T23)", () => {
  it("moves focus to the next card on ArrowRight via the data-card-link selector", () => {
    const { container } = render(
      <RowCarousel
        rowId="trendingNow"
        items={items}
        hasMore={false}
        isFetching={false}
        onNearEnd={() => {}}
      />,
    );
    // RowCarousel wraps each card in a slide div the keyboard handler is
    // attached to. The card link sits one level deeper.
    const slideDivs = container.querySelectorAll<HTMLDivElement>("div.shrink-0");
    expect(slideDivs.length).toBe(items.length);
    const firstLink = within(slideDivs[0]!).getByTestId("home-card") as HTMLAnchorElement;
    firstLink.focus();
    fireEvent.keyDown(slideDivs[0]!, { key: "ArrowRight" });
    const secondLink = within(slideDivs[1]!).getByTestId("home-card") as HTMLAnchorElement;
    expect(document.activeElement).toBe(secondLink);
  });
});
