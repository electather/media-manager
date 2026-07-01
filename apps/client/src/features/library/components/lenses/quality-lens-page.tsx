import { LensPage } from "./lens-page";
import { QualityLens } from "./quality-lens";

/** `/library/quality` — the quality-tier lens. */
export function QualityLensPage() {
  return (
    <LensPage
      lens="quality"
      render={({ entries, hasNextPage, isFetchingNextPage, fetchNextPage, error }) => (
        <QualityLens
          entries={entries}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          error={error}
        />
      )}
    />
  );
}
