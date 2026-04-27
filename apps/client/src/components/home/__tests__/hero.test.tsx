// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LayoutHero } from "@ent-mcp/shared/home";

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: navigateMock }) };
});

const useArtworkMock = vi.hoisted(() => vi.fn(() => ({ data: undefined })));
vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: useArtworkMock,
  EMPTY_BUNDLE: { poster: [], backdrop: [], clearLogo: [], thumb: [] },
}));

import { Hero } from "../hero";

const baseHero: LayoutHero = {
  item: {
    id: "movie:550",
    tmdbId: "550",
    mediaType: "movie",
    title: "Fight Club",
    backdrop: "b.jpg",
    progress: { watched: 30, total: 90 },
  },
  source: "continueWatching",
  reason: "continue_watching",
  resumeUrl: null,
};

beforeEach(() => {
  navigateMock.mockReset();
  useArtworkMock.mockReset();
  useArtworkMock.mockReturnValue({ data: undefined });
});
afterEach(() => cleanup());

function lastEnabled(): boolean | undefined {
  const calls = useArtworkMock.mock.calls;
  if (calls.length === 0) return undefined;
  const lastCall = calls[calls.length - 1] as unknown as [unknown, { enabled?: boolean }?];
  return lastCall[1]?.enabled;
}

describe("Hero (V32, resumeUrl null check)", () => {
  it("opens the peek modal when resumeUrl is null", async () => {
    const user = userEvent.setup();
    render(<Hero hero={baseHero} />);
    await user.click(screen.getByTestId("home-hero"));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]![0].replace).toBe(false);
  });

  it("opens the resumeUrl in a new tab when resumeUrl is a non-empty string", async () => {
    const hero: LayoutHero = { ...baseHero, resumeUrl: "https://plex.example/play/abc" };
    render(<Hero hero={hero} />);
    const link = screen.getByTestId("home-hero");
    expect(link.getAttribute("href")).toBe("https://plex.example/play/abc");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("opens the peek modal when source is not continueWatching, even with a resumeUrl", async () => {
    const user = userEvent.setup();
    const hero: LayoutHero = {
      ...baseHero,
      source: "recommendedForYou",
      resumeUrl: "https://plex.example/play/abc",
    };
    render(<Hero hero={hero} />);
    await user.click(screen.getByTestId("home-hero"));
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });
});

describe("Hero inline canonical URL preference (V47)", () => {
  it("renders inline backdrop and clearLogo without firing artwork.get", () => {
    const hero: LayoutHero = {
      ...baseHero,
      item: { ...baseHero.item, backdrop: "b.jpg", clearLogo: "l.png" },
    };
    render(<Hero hero={hero} />);
    expect(lastEnabled()).toBe(false);
    const imgs = Array.from(document.querySelectorAll("img"));
    expect(imgs.some((img) => img.getAttribute("src") === "b.jpg")).toBe(true);
    expect(imgs.some((img) => img.getAttribute("src") === "l.png")).toBe(true);
  });

  it("fires artwork.get when an inline canonical URL is missing", () => {
    const hero: LayoutHero = {
      ...baseHero,
      item: { ...baseHero.item, backdrop: "b.jpg", clearLogo: undefined },
    };
    render(<Hero hero={hero} />);
    expect(lastEnabled()).toBe(true);
  });
});
