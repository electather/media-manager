import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db";
import type { MediaDetail } from "@ent-mcp/shared/media";

/**
 * Entity row tracked client-side. Compact rows arrive from `home.*` writes
 * and full rows arrive from `media.get`; `_detailFetchedAt` distinguishes
 * the two states (C20).
 *
 * Persistence note (T48 / RISK-011): `localOnlyCollectionOptions` is in
 * memory only — TanStack DB does not honour `meta.persist` here (only the
 * react-query persister does). Offline reload of the home layout works via
 * `homeLayoutCollection` which is `queryCollectionOptions`-backed; rows
 * rebuild on next mount via `loadRowPage`.
 */
export interface MediaRow extends MediaDetail {
  _detailFetchedAt: number | null;
}

export const mediaCollection = createCollection(
  localOnlyCollectionOptions<MediaRow>({
    id: "media.entity",
    getKey: (row) => row.id,
  }),
);
