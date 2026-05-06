// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Season } from "../lib/types";
import { MovieRequestAction } from "../components/movie-request-action";
import { RequestableSeasons } from "../components/requestable-seasons";

afterEach(() => {
  cleanup();
});

const seasonsForId = (suffix: string): Season[] => [
  {
    number: 1,
    episodeCount: 2,
    counts: { unavailable: 2 },
    episodes: [
      {
        id: `${suffix}-s1e1`,
        episode: 1,
        title: "Pilot",
        airDate: "2024-01-01",
        runtime: 42,
        status: "unavailable",
      },
      {
        id: `${suffix}-s1e2`,
        episode: 2,
        title: "Aftershock",
        airDate: "2024-01-08",
        runtime: 42,
        status: "unavailable",
      },
    ],
  },
];

describe("MovieRequestAction reset on item change", () => {
  it("clears the pending status when the parent navigates to a new movie", () => {
    const { rerender } = render(
      <MovieRequestAction itemId="movie:a" itemTitle="Movie A" initialStatus="unavailable" />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^request movie$/i }));
    expect(screen.getByText(/awaiting approval/i)).toBeTruthy();

    rerender(
      <MovieRequestAction itemId="movie:b" itemTitle="Movie B" initialStatus="unavailable" />,
    );

    expect(screen.queryByText(/awaiting approval/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^request$/i })).toBeTruthy();
  });
});

describe("RequestableSeasons reset on item change", () => {
  it("does not leak season overrides between titles", () => {
    const { rerender } = render(
      <RequestableSeasons itemId="tv:a" itemTitle="Show A" seasons={seasonsForId("a")} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /request missing/i }));
    fireEvent.click(screen.getByRole("button", { name: /request season/i }));
    // Pending sublines (`{n} episodes — awaiting approval`) only appear
    // once the override has been applied to a season, so they are a clean
    // signal that the request was registered.
    expect(screen.getByText(/awaiting approval/i)).toBeTruthy();

    rerender(<RequestableSeasons itemId="tv:b" itemTitle="Show B" seasons={seasonsForId("b")} />);

    // The fresh title should re-derive its season state from props, not
    // inherit the previous title's pending override on season 1.
    expect(screen.queryByText(/awaiting approval/i)).toBeNull();
    expect(screen.getByRole("button", { name: /request missing/i })).toBeTruthy();
  });
});
