import { LensPage } from "./lens-page";
import { ServersLens } from "./servers-lens";

/** `/library/server` — the per-server availability lens. */
export function ServersLensPage() {
  return (
    <LensPage
      lens="server"
      render={({ entries, hasNextPage, isFetchingNextPage, fetchNextPage }) => (
        <ServersLens
          entries={entries}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
        />
      )}
    />
  );
}
