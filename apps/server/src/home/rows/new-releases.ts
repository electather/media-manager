import { newReleasesSource } from "../sources/discover-snapshot";
import { makeDiscoverSnapshotRow } from "./discover-snapshot";

// `discover-snapshot` job writes `(newReleases, popularity_desc, day)` —
// the only persisted sort for this feed. Reading the design-doc-suggested
// `release_date_asc` would never resolve. Sort drift tracked in PR
// follow-up; the source aligns to what the job actually persists.
const provider = makeDiscoverSnapshotRow({
  rowId: "newReleases",
  kind: "newReleases",
  titleKey: "home_row_newReleases_header",
  feedKind: "newReleases",
  sort: "popularity_desc",
  source: newReleasesSource,
});

export default provider;
