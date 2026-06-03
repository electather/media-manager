import { compact } from "es-toolkit/array";
import { dispatchAggregate } from "../../media";
import { capabilityRegistry } from "../../plugin-runtime";
import { type AvailabilityStatus, type CompactMediaResult } from "../response-shapes";

interface AvailabilityRow {
  status?: AvailabilityStatus;
}

/**
 * Builds a per-item availability map by querying connected mediaRequest@v1
 * providers. Short-circuits to an empty map when there are no providers or no
 * items, and swallows per-item failures since availability is best-effort.
 */
export async function buildAvailabilityMap(
  userId: string,
  items: CompactMediaResult[],
): Promise<Map<string, AvailabilityStatus>> {
  const providers = capabilityRegistry.listProviders("mediaRequest", "v1", "user");
  if (providers.length === 0 || items.length === 0) return new Map();
  const map = new Map<string, AvailabilityStatus>();
  const pairs = compact(
    items.map((item) => {
      const [type, tmdbId] = item.id.split(":");
      if (!type || !tmdbId) return null;
      return { id: item.id, tmdbId, type: type as "movie" | "tv" };
    }),
  );

  await Promise.all(
    // fallow-ignore-next-line complexity
    pairs.map(async (pair) => {
      try {
        const result = await dispatchAggregate<AvailabilityRow[]>({
          userId,
          capability: "mediaRequest",
          version: "v1",
          method: "checkAvailability",
          input: { tmdbId: pair.tmdbId, type: pair.type },
        });
        const first = (result.data ?? []).find((row) => row && row.status);
        if (first?.status) map.set(pair.id, first.status);
      } catch {
        // Availability is best-effort; ignore per-item failures.
      }
    }),
  );
  return map;
}
