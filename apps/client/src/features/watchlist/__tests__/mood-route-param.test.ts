import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { MOOD_IDS } from "@ent-mcp/shared/watchlist";

// Mirrors the parser used by
// apps/client/src/routes/_authenticated/_app/watchlist.moods.$moodId.tsx.
// Pin the invariant that unknown mood ids fail the route param parser, so
// the surrounding ErrorBoundary renders instead of mounting the mood page
// with garbage state (V.WL7).
const paramSchema = z.object({ moodId: z.enum(MOOD_IDS) });

describe("watchlist mood route param schema", () => {
  it("accepts each known mood id", () => {
    for (const id of MOOD_IDS) {
      expect(paramSchema.parse({ moodId: id }).moodId).toBe(id);
    }
  });

  it("throws on an unknown mood id", () => {
    expect(() => paramSchema.parse({ moodId: "banana" })).toThrow();
  });
});
