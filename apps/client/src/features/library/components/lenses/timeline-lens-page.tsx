import { LensPage } from "./lens-page";
import { TimelineLens } from "./timeline-lens";

/** `/library/timeline` — the release-decade lens. */
export function TimelineLensPage() {
  return <LensPage render={({ items }) => <TimelineLens items={items} />} />;
}
