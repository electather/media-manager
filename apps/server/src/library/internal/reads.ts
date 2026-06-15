import { clearSeedLock, trySeedLock } from "../repo";
// Pre-existing reads.ts ↔ service.ts cycle from #542; refactor tracked in #666.
// fallow-ignore-next-line circular-dependency
import { syncMembership } from "../service";
import type { MaybeLibraryContext } from "../types";
import { asLibraryContext } from "./context";

/**
 * Eager-seed trigger run on the first page of a library read (the lens sources'
 * `fetchRawSet` and `/facets`), mirroring `watchlist/internal/reads.ts` (whose
 * `getItems` seeds on its first page). A brand-new user has no `library_items`
 * rows until the 6-hourly cron runs, so the first read would otherwise show an
 * empty library; this seeds membership inline so the page is populated on first
 * paint.
 *
 * `trySeedLock` claims the per-user seed marker atomically — only the caller
 * that wins the race runs the membership fetch, so concurrent first reads do
 * not double-fetch. On success the lock stays so later reads skip seeding (the
 * 6-hourly cron owns ongoing reconciliation). On a feed error the lock is
 * rolled back so the next read retries. Hydration is deliberately NOT awaited
 * here — it stays lazy/async (the hourly job and the post-sync hydrate fill the
 * denormalized columns), so the first paint may show un-hydrated rows (no
 * servers/quality/franchise). That is acceptable per design §Known fuzzy areas.
 *
 * The membership sync swallows feed errors internally and busts the facets
 * cache on success, so this returns void — a seed failure must never fail the
 * read it rode in on.
 */
export async function ensureSeeded(ctx: MaybeLibraryContext): Promise<void> {
  const c = asLibraryContext(ctx);
  const acquired = await trySeedLock(c.userId, Date.now());
  if (!acquired) return;
  try {
    await syncMembership(c);
  } catch (err) {
    // `syncMembership` already swallows feed errors, so reaching here means an
    // unexpected throw (e.g. a DB write failure). Roll the lock back so the next
    // read retries the seed rather than treating the user as permanently seeded.
    c.log.warn("[library:seed] eager seed failed; clearing lock for retry", err);
    await clearSeedLock(c.userId);
  }
}
