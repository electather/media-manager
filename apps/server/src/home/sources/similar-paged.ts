import { z } from "zod";
import { mediaTypeSchema, type MediaType } from "@ent-mcp/shared";
import { encode, type Cursor, type MediaSource } from "../../media";
import { resolveSimilarCandidates, ROW_PAGE_SIZE, type MediaKey } from "../rows/_shared";

/**
 * The seed + page offset a similar-feed row threads through its cursor. It
 * rides inside the unified keyset cursor's `k` as JSON (design §E: "source
 * seed rides inside `k` for keyset sources, exactly as `becauseYouWatched`
 * carries its seed today"). `becauseYouWatched` derives the seed from history
 * in `initialCursor`; `similarTo` gets it from the client (the detail page).
 */
export const seedTokenSchema = z.object({
  seedId: z.string().min(1),
  seedType: mediaTypeSchema,
  offset: z.number().int().min(0),
});

export type SeedToken = z.infer<typeof seedTokenSchema>;

/** Mints the initial keyset cursor for a similar-feed row from its seed. */
export function encodeSeedCursor(seed: { seedId: string; seedType: MediaType }): string {
  return encode({ mode: "keyset", k: JSON.stringify({ ...seed, offset: 0 }) });
}

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

/**
 * Seed-paged similar-feed source (design §H/§S, Phase 5). One keyset source
 * serves both the `becauseYouWatched` and `similarTo` rows — they differ only
 * in how the consumer derives the seed (recent history vs a detail page), which
 * rides in the cursor `k`, not the source. `fetchRawSet` reads the seed +
 * offset out of `k`, resolves the cached `metadata@v1.getSimilar` candidates,
 * windows them by `offset`, and threads back the next-offset token as `nextRaw`
 * (omitted when the window reaches the end so `paginate` mints `cursor:null`,
 * #500). It stashes the seed title on `ctx.seedTitle` so the home enrich
 * override's match-reason chip (`similar_to_seed`) can surface it.
 *
 * The candidate slice + `nextRaw` are the keyset source's legitimate resume
 * position (V.MC1 reserves enrich/sort to the pipeline, but a keyset source
 * owns its window, like the watchlist mood source); `paginate` keyset then
 * passes the already-windowed rows through and mints the next cursor.
 */
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
