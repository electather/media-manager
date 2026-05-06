import { makeRecommendedForYou } from "./recommended-for-you";

const provider = makeRecommendedForYou({
  rowId: "recommendedForYou-tv",
  titleKey: "home_row_tvShowsToRequest_header",
  mediaType: "tv",
});

export default provider;
