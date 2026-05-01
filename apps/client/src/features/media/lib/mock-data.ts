import type { DetailEpisode, DetailSeason, MediaDetailItem } from "./types";

const HERO: MediaDetailItem = {
  id: "movie:550",
  kind: "movie",
  title: "Fight Club",
  clearLogo: { text: "FIGHT CLUB" },
  image: {
    "16/9": "https://image.tmdb.org/t/p/original/52AfXWuXCHn3UjD17rBruA9f5qb.jpg",
    "2/3": "https://image.tmdb.org/t/p/w780/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
  },
  year: 1999,
  runtime: "2h 19m",
  ageRating: "R",
  genres: ["Drama", "Thriller"],
  rating: 8.4,
  votes: 26000,
  audienceScore: 96,
  criticScore: 79,
  tags: ["cult-classic", "psychological", "twist-ending"],
  overview:
    "An insomniac office worker and a devil-may-care soap maker form an underground fight club that evolves into much more.",
  director: "David Fincher",
  cast: ["Brad Pitt", "Edward Norton", "Helena Bonham Carter"],
  matchReason: "Because you watched Se7en",
  streamLink: { source: "Plex" },
  progress: { watched: 0, total: 0 },
};

const ALT_TV: MediaDetailItem = {
  id: "tv:1396",
  kind: "tv",
  title: "Breaking Bad",
  clearLogo: { text: "BREAKING BAD" },
  image: {
    "16/9": "https://image.tmdb.org/t/p/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
    "2/3": "https://image.tmdb.org/t/p/w780/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
  },
  year: 2008,
  runtime: "5 seasons",
  ageRating: "TV-MA",
  genres: ["Crime", "Drama"],
  rating: 9.5,
  audienceScore: 97,
  criticScore: 96,
  tags: ["antihero", "slow-burn"],
  overview:
    "A high school chemistry teacher diagnosed with terminal lung cancer turns to manufacturing methamphetamine to secure his family's future.",
  director: "Vince Gilligan",
  cast: ["Bryan Cranston", "Aaron Paul"],
  seriesStatus: "finished",
};

const UPCOMING: MediaDetailItem[] = [];

const ROWS: { id: string; items: MediaDetailItem[] }[] = [
  { id: "trending", items: [HERO, ALT_TV] },
];

function buildEpisodes(
  season: number,
  count: number,
  baseStatus: DetailEpisode["status"],
): DetailEpisode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ep:${season}:${i + 1}`,
    episode: i + 1,
    title: `Episode ${i + 1}`,
    airDate: "2024-01-01",
    runtime: 47,
    status: baseStatus,
  }));
}

function generateSeasons(item: MediaDetailItem): DetailSeason[] {
  if (item.kind !== "tv") return [];
  const totals = [7, 13, 13, 13, 16];
  return totals.map((count, i) => {
    const isLast = i === totals.length - 1;
    const status: DetailSeason["status"] = isLast ? "available" : "available";
    return {
      id: `${item.id}:s${i + 1}`,
      title: `Season ${i + 1}`,
      episodeCount: count,
      status,
      episodes: buildEpisodes(i + 1, count, status),
    };
  });
}

export const mockData = { HERO, UPCOMING, ROWS, generateSeasons };
