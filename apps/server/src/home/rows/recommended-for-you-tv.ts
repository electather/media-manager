import { makeRecommendedForYou } from "./recommended-for-you";

const provider = makeRecommendedForYou({
  rowId: "recommendedForYou-tv",
  titleKey: "home_row_tvShowsToRequest_header",
  eyebrowKey: "home_row_tvShowsToRequest_eyebrow",
  mediaType: "tv",
});

export default provider;
