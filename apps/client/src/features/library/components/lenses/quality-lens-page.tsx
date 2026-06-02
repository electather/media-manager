import { LensPage } from "./lens-page";
import { QualityLens } from "./quality-lens";

/** `/library/quality` — the quality-tier lens. */
export function QualityLensPage() {
  return <LensPage render={({ items }) => <QualityLens items={items} />} />;
}
