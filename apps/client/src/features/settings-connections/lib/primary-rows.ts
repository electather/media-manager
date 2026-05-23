import type { MediaType } from "@ent-mcp/shared/media";
import { m } from "@/paraglide/messages";

// Append here to add a new `primary_with_enrichment` capability picker row — server endpoints are generic.
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
