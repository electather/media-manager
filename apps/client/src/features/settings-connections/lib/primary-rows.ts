import type { MediaType } from "@ent-mcp/shared/media";
import { m } from "@/paraglide/messages";

/**
 * Static list of picker rows the UI renders today. Each row is one
 * `(capabilityKey, mediaType)` slot in the `primary_connections` table.
 *
 * Adding a new `primary_with_enrichment` capability later = append a row
 * here. The server endpoints are already generic and pick up the new
 * tuple without code changes.
 */
export const PRIMARY_PROVIDER_ROWS: ReadonlyArray<{
  capabilityKey: string;
  mediaType: MediaType;
  labelMessage: () => string;
}> = [
  {
    capabilityKey: "metadata@v1",
    mediaType: "movie",
    labelMessage: m.settings_connections_primary_movies_label,
  },
  {
    capabilityKey: "metadata@v1",
    mediaType: "tv",
    labelMessage: m.settings_connections_primary_tv_label,
  },
];
