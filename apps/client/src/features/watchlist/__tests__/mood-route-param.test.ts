import { describe, expect, it } from "vite-plus/test";
import { notFound } from "@tanstack/react-router";
import { MOOD_IDS } from "@ent-mcp/shared/watchlist";

// Mirrors the membership guard in
// apps/client/src/routes/_authenticated/_app/watchlist.moods.$moodId.tsx.
// #515: an unknown mood id now yields a clean 404 (`throw notFound()`) so the
// root notFoundComponent renders, instead of a param-parse error surfacing in
// the section ErrorBoundary (V.WL7).
const MOOD_ID_SET: ReadonlySet<string> = new Set(MOOD_IDS);

function guard(moodId: string): void {
  if (!MOOD_ID_SET.has(moodId)) throw notFound();
}

describe("watchlist mood route param guard", () => {
  it("admits each known mood id", () => {
    for (const id of MOOD_IDS) {
      expect(() => guard(id)).not.toThrow();
    }
  });

  it("throws notFound on an unknown mood id", () => {
    // Assert the specific `notFound()` shape so the test can't pass on an
    // unrelated throw (e.g. a future param-parse error).
    expect(() => guard("banana")).toThrow(expect.objectContaining({ isNotFound: true }));
  });
});
