import { z } from "zod";
import { mediaTypeSchema } from "@nama/shared";
import type { Cursor, MediaSource } from "../../media";
import { resolveSimilarCandidates, ROW_PAGE_SIZE, type MediaKey } from "../rows/_shared";

// `encodeSeedCursor` is the relocated shared codec helper (design §A5).
// Re-exported here so `because-you-watched.ts` keeps importing unchanged;
// `decodeSeedToken`/`SeedToken` stay home-source-private (would drag home paging across boundary).
export { encodeSeedCursor } from "../../media";

// Seed + page offset ride inside keyset cursor's `k` as JSON (design §E).
// `becauseYouWatched` derives seed from history; `similarTo` gets it from client (detail page).
export const seedTokenSchema = z.object({
  seedId: z.string().min(1),
  seedType: mediaTypeSchema,
  offset: z.number().int().min(0),
});

export type SeedToken = z.infer<typeof seedTokenSchema>;

/** Parses + validates the seed-token JSON; `null` on bad JSON or shape. */
function parseSeedJson(k: string): SeedToken | null {
  try {
    const parsed = seedTokenSchema.safeParse(JSON.parse(k));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Parses the seed token out of a decoded keyset cursor; `null` on any miss. */
function decodeSeedToken(cursor: Cursor | null): SeedToken | null {
  return cursor?.mode === "keyset" ? parseSeedJson(cursor.k) : null;
}

/** The next-page hop token (omitted when the window reached the candidate end). */
function seedNextRaw(seed: SeedToken, candidateCount: number): string | undefined {
  const nextOffset = seed.offset + ROW_PAGE_SIZE;
  return candidateCount > nextOffset ? JSON.stringify({ ...seed, offset: nextOffset }) : undefined;
}

// Seed-paged similar-feed source (design §H/§S, Phase 5). One keyset source serves both
// `becauseYouWatched` and `similarTo` rows, differing only in seed derivation (history vs detail page).
// Reads seed+offset from cursor `k`, resolves cached `metadata@v1.getSimilar`, windows by offset,
// threads back next-offset token as `nextRaw` (omitted at end so `paginate` mints `cursor:null`, #500).
// Stashes seed title on `ctx.seedTitle` for match-reason chip (`similar_to_seed`).
// Candidate slice + `nextRaw` are the keyset source's resume position (V.MC1 reserves enrich/sort to pipeline;
// keyset source owns its window, like watchlist mood source); `paginate` keyset passes already-windowed rows through.
export const similarPagedSource: MediaSource<void, MediaKey> = {
  sourceId: "home.similarPaged",
  async fetchRawSet(ctx, _params, cursor) {
    const seed = decodeSeedToken(cursor);
    if (!seed) return { rows: [], partial: false };
    const { candidates, partial, seedTitle } = await resolveSimilarCandidates(
      ctx,
      seed.seedId,
      seed.seedType,
    );
    if (seedTitle) ctx.seedTitle = seedTitle;
    const window = candidates.slice(seed.offset, seed.offset + ROW_PAGE_SIZE);
    const nextRaw = seedNextRaw(seed, candidates.length);
    return { rows: window, partial, ...(nextRaw !== undefined ? { nextRaw } : {}) };
  },
  // Keyset: the source owns the candidate window + resume token. `"none"`: the
  // feed is relevance-ranked, so the pipeline preserves the source's order.
  stages: { sort: "none", cursorMode: "keyset" },
};
