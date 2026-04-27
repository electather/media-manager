import { z } from "zod";
import { defineCapability, method } from "../define";

const refreshLibraryInput = z.object({
  /**
   * Server-local section id. When omitted, the plugin refreshes all sections
   * it can see (Plex: iterates sections with force=1; Jellyfin: hits the
   * server-wide `/Library/Refresh`).
   */
  librarySectionId: z.string().optional(),
});

const refreshItemInput = z.object({
  /** Server-local item id (Plex ratingKey, Jellyfin itemId). */
  serverItemId: z.string().min(1),
});

// Both operations are fire-and-forget: the backing endpoints return empty
// bodies with no scan id or progress handle, so the contract is only "the
// server accepted the request". Intentionally no `invalidates` — invalidating
// libraryAvailability@v1 here would surface stale re-fetches until the scan
// actually completes server-side, which can take seconds to minutes. Hosts
// that need to force a fresh read after a refresh should do so explicitly.
const refreshOutput = z.object({ ok: z.boolean() });

/**
 * libraryAdmin@v1 — trigger server-side rescan / metadata refresh on demand.
 * Intended caller is the host itself, invoked after a successful
 * `mediaRequest@v1` fulfilment so the new file lands in the library without
 * waiting on the periodic scan. That host wiring is tracked as a follow-up
 * (see issue #21) — this packet only declares the capability contract.
 *
 * No `mcpTools` in this revision — they land with the Plex/Jellyfin plugin
 * implementations (#22, #23).
 */
export const LibraryAdminV1 = defineCapability({
  id: "libraryAdmin",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 30,
  negativeCacheTtlSec: 15,
  defaultTimeoutMs: 30_000,
  methods: {
    refreshLibrary: method(refreshLibraryInput, refreshOutput),
    refreshItem: method(refreshItemInput, refreshOutput),
  },
});
