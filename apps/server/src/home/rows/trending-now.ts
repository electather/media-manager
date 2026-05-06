import { makeDiscoverSnapshotRow } from "./discover-snapshot";

const provider = makeDiscoverSnapshotRow({
  rowId: "trendingNow",
  kind: "trendingNow",
  titleKey: "home_row_trendingNow_header",
  feedKind: "trending",
  sort: "popularity_desc",
});

export default provider;
