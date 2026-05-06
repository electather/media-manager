import { makeRecommendedForYou } from "./recommended-for-you";

const provider = makeRecommendedForYou({
  rowId: "recommendedForYou-movies",
  titleKey: "home_row_moviesToRequest_header",
  mediaType: "movie",
});

export default provider;
