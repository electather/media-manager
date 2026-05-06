import { makeDiscoverSnapshotRow } from "./discover-snapshot";

const provider = makeDiscoverSnapshotRow({
  rowId: "newReleases",
  kind: "newReleases",
  titleKey: "home_row_newReleases_header",
  feedKind: "newReleases",
  sort: "release_date_asc",
});

export default provider;
