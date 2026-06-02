import { CollectionsLens } from "./collections-lens";
import { LensPage } from "./lens-page";

/** `/library/collections` — the curated-collections lens. */
export function CollectionsLensPage() {
  return (
    <LensPage
      render={({ items, collections }) => (
        <CollectionsLens items={items} collections={collections} />
      )}
    />
  );
}
