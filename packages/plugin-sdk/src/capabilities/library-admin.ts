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

// Fire-and-forget: endpoints return empty bodies, no progress handle.
// Intentionally no `invalidates` — would cause stale re-fetches until
// server-side scan completes (seconds to minutes).
const refreshOutput = z.object({ ok: z.boolean() });

/**
 * libraryAdmin@v1 — trigger server-side rescan / metadata refresh on demand.
 * Intended caller is the host after `mediaRequest@v1` fulfilment (#21).
 * No `mcpTools` in this revision — they land with Plex/Jellyfin implementations (#22, #23).
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
