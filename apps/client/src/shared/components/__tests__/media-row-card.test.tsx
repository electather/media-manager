// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaRowCard, type MediaRowCardItem } from "../media-row-card";

afterEach(cleanup);

function makeItem(overrides: Partial<MediaRowCardItem> = {}): MediaRowCardItem {
  return {
    id: "movie:550",
    title: "Fight Club",
    poster: "https://img.example/poster.jpg",
    backdrop: "https://img.example/backdrop.jpg",
    ...overrides,
  };
}

describe("MediaRowCard", () => {
  it("defaults to a 2/3 poster aspect", () => {
    const { container } = render(<MediaRowCard item={makeItem()} />);
    const root = container.querySelector('[data-slot="media-card"]');
    expect(root?.getAttribute("data-aspect")).toBe("2/3");
    const img = container.querySelector('[data-slot="media-card-image"]');
    expect(img?.className).toContain("aspect-[2/3]");
  });

  it("flips to backdrop art and reveals the clear logo in 16/9", () => {
    const { container } = render(
      <MediaRowCard item={makeItem({ clearLogo: "https://img.example/logo.png" })} aspect="16/9" />,
    );
    const root = container.querySelector('[data-slot="media-card"]');
    expect(root?.getAttribute("data-aspect")).toBe("16/9");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://img.example/backdrop.jpg",
    );
    expect(container.querySelector('[data-slot="media-card-clear-logo"]')).toBeTruthy();
  });

  it("hides the clear logo on 2/3 even when an asset is present", () => {
    const { container } = render(
      <MediaRowCard item={makeItem({ clearLogo: "https://img.example/logo.png" })} />,
    );
    expect(container.querySelector('[data-slot="media-card-clear-logo"]')).toBeNull();
  });

  it("derives an availability pill from item.availability.servers", () => {
    const { container } = render(
      <MediaRowCard
        item={makeItem({
          availability: {
            hasAnyServerCopy: true,
            requestEligible: false,
            servers: [{ id: "c1", label: "Plex" }],
          },
        })}
      />,
    );
    const pill = container.querySelector('[data-slot="media-card-availability"]');
    expect(pill?.getAttribute("data-kind")).toBe("server");
    expect(pill?.textContent).toContain("Plex");
  });

  it("falls back to buildMediaHref(item.id) when href is omitted", () => {
    render(<MediaRowCard item={makeItem({ id: "tv:1396" })} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/media/tv/1396");
  });

  it("calls onPress with item.id on a plain left-click", () => {
    const onPress = vi.fn();
    render(<MediaRowCard item={makeItem()} onPress={onPress} />);
    fireEvent.click(screen.getByRole("link"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith("movie:550");
  });

  it("renders the badge / progress / quickAction / meta slots", () => {
    render(
      <MediaRowCard
        item={makeItem()}
        badge={<span data-testid="badge">badge</span>}
        progress={<span data-testid="progress">progress</span>}
        quickAction={<button data-testid="action">add</button>}
        meta={<div data-testid="meta">meta</div>}
      />,
    );
    expect(screen.getByTestId("badge")).toBeTruthy();
    expect(screen.getByTestId("progress")).toBeTruthy();
    expect(screen.getByTestId("action")).toBeTruthy();
    expect(screen.getByTestId("meta")).toBeTruthy();
  });

  it("uses linkAriaLabel when provided, else falls back to item.title", () => {
    const { rerender } = render(<MediaRowCard item={makeItem()} />);
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe("Fight Club");
    rerender(<MediaRowCard item={makeItem()} linkAriaLabel="Open Fight Club details" />);
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe("Open Fight Club details");
  });

  it("forwards rootProps to the root article (data-testid passthrough)", () => {
    render(<MediaRowCard item={makeItem()} rootProps={{ "data-testid": "row-card" }} />);
    expect(screen.getByTestId("row-card").getAttribute("data-slot")).toBe("media-card");
  });
});
