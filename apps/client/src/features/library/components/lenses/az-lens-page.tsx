import { AzLens } from "./az-lens";
import { LensPage } from "./lens-page";

/** `/library` (index) — the alphabetical index lens. */
export function AzLensPage() {
  return <LensPage render={({ items }) => <AzLens items={items} />} />;
}
