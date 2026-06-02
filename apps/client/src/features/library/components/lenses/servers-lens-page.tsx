import { LensPage } from "./lens-page";
import { ServersLens } from "./servers-lens";

/** `/library/server` — the per-server availability lens. */
export function ServersLensPage() {
  return <LensPage render={({ items }) => <ServersLens items={items} />} />;
}
