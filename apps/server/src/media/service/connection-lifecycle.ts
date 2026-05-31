import { consola } from "consola";
import { eq } from "drizzle-orm";
import { isEqual } from "es-toolkit/predicate";
import { getDb } from "../../db/client";
// TASK-047: media reads serviceConnections via plugin-runtime barrel (deferred).
// fallow-ignore-next-line boundary-violation
import { serviceConnections } from "../../db/schema/plugin-runtime/credentials";
import { encryptJson, decryptJson } from "../../crypto/helpers";
import { pluginRuntime } from "../../plugin-runtime";
import { emit } from "../../jobs/events";
import { MEDIA_EVENTS, connectionAuthExpiredPayload } from "../events";

export async function emitAuthExpired(args: {
  connectionId: string;
  pluginId: string;
  userId: string;
}): Promise<void> {
  try {
    await emit(MEDIA_EVENTS.CONNECTION_AUTH_EXPIRED, connectionAuthExpiredPayload, args);
  } catch (err) {
    consola.error("[dispatcher] auth-expired notification emit failed:", err);
  }
}

export async function persistRefreshedCredentials(
  connectionId: string,
  credentials: unknown,
): Promise<void> {
  const { iv, data } = await encryptJson(credentials);
  await getDb()
    .update(serviceConnections)
    .set({
      encryptedCredentials: data,
      credentialsIv: iv,
      status: "connected",
      errorMessage: null,
      // Refresh succeeded — clear any rate-limit cooldown left by a prior 429
      // so the row stops carrying a stale `retryAfter` epoch.
      retryAfter: null,
      lastVerifiedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(serviceConnections.id, connectionId));
}

/** Reads and decrypts the credentials currently stored for a connection. */
async function readConnectionCredentials(connectionId: string): Promise<unknown> {
  const row = await getDb()
    .select({
      encryptedCredentials: serviceConnections.encryptedCredentials,
      credentialsIv: serviceConnections.credentialsIv,
    })
    .from(serviceConnections)
    .where(eq(serviceConnections.id, connectionId))
    .get();
  if (!row) return null;
  return decryptJson(row.credentialsIv, row.encryptedCredentials);
}

// Coalesces concurrent token refreshes per connection. OAuth providers that
// rotate refresh tokens (Trakt) invalidate the previous refresh token the
// instant a new one is issued, so two refreshes started from the same stored
// token leave the second presenting an already-consumed token — the upstream
// rejects it with a 4xx that maps to `plugin.token_expired`, flipping a healthy
// connection to "expired". A home-feed load fans capability calls out in
// parallel, so an expired access token triggers a burst of simultaneous
// refreshes on one connection; sharing a single in-flight refresh collapses the
// burst to one upstream call whose result every caller observes.
const inFlightRefreshes = new Map<string, Promise<unknown>>();

interface RefreshArgs {
  connectionId: string;
  pluginId: string;
  userId: string;
  attemptedCredentials: unknown;
}

/**
 * Refreshes a connection's credentials, coalescing concurrent callers and
 * adopting a token another refresher already rotated in (the scheduled job, or
 * an earlier burst) rather than replaying a consumed refresh token. Persists the
 * rotated credentials on success. Surfaces the underlying refresh error as
 * terminal only when the stored token is unchanged — i.e. the failure genuinely
 * reflects this connection's grant, not a lost rotation race.
 */
export async function refreshConnectionCredentials(args: RefreshArgs): Promise<unknown> {
  const existing = inFlightRefreshes.get(args.connectionId);
  if (existing) return existing;
  const run = performConnectionRefresh(args).finally(() => {
    inFlightRefreshes.delete(args.connectionId);
  });
  inFlightRefreshes.set(args.connectionId, run);
  return run;
}

// Token-rotation race guards (re-read + isEqual on the pre-call and catch paths) drive
// the branch count; none is removable without dropping a race check, and CRAP is inflated
// by the coverage-less audit.
// fallow-ignore-next-line complexity
async function performConnectionRefresh(args: RefreshArgs): Promise<unknown> {
  const { connectionId, pluginId, userId, attemptedCredentials } = args;
  // Another refresher may have rotated the stored token since this caller read
  // its credentials (the scheduled job, or a burst whose in-flight entry has
  // already cleared). If so, adopt the rotated token instead of replaying the
  // consumed one upstream.
  const current = await readConnectionCredentials(connectionId);
  if (current !== null && !isEqual(current, attemptedCredentials)) return current;
  try {
    const refreshed = await pluginRuntime.refreshAuth(pluginId, userId, attemptedCredentials);
    await persistRefreshedCredentials(connectionId, refreshed);
    return refreshed;
  } catch (err) {
    // Lost a rotation race between the read above and the upstream call (e.g.
    // the scheduled job committed first): the 4xx reflects our now-consumed
    // token, not a revoked grant. If the stored token changed, adopt it rather
    // than surfacing an expiry.
    const latest = await readConnectionCredentials(connectionId);
    if (latest !== null && !isEqual(latest, attemptedCredentials)) return latest;
    throw err;
  }
}

export async function markConnectionStatus(
  connectionId: string | null,
  status: "expired" | "error",
  message: string,
): Promise<void> {
  if (!connectionId) return;
  await getDb()
    .update(serviceConnections)
    .set({ status, errorMessage: message, updatedAt: Date.now() })
    .where(eq(serviceConnections.id, connectionId));
}
