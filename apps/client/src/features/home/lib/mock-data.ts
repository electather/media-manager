import { ROW_ASPECT } from "./home-feed-config";
import type {
  HeroItem,
  HomeFeedData,
  HomeMediaItem,
  MatchReasonKey,
  MockEpisode,
  MockEpisodeStatus,
  MockSeason,
  RowData,
  RowKind,
} from "./types";

const img = (seed: string, w: number, h: number) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

function serverAvailability(labels: string[] = [], requestEligible = false) {
  return {
    hasAnyServerCopy: labels.length > 0,
    requestEligible,
    servers: labels.map((label) => ({ id: label.toLowerCase(), label })),
  };
}

function requestAvailability(requestEligible = true) {
  return { hasAnyServerCopy: false, requestEligible, servers: [] };
}

function progress(watched: number, total: number) {
  return { watched, total };
}

/** Base media items before applying row-specific overrides. */
const ALSO_WATCHING: HomeMediaItem[] = [
  {
    id: "movie:n-blue-hour",
    tmdbId: "n-blue-hour",
    mediaType: "movie",
    title: "Blue Hour",
    year: 2023,
    backdrop: img("blue-hour", 800, 500),
    poster: img("blue-hour-p", 600, 900),
    clearLogoText: "BLUE·HOUR",
    tags: ["4K", "HDR"],
    genres: ["Drama"],
    rating: 7.8,
    progress: progress(1, 17),
  },
  {
    id: "tv:n-portal",
    tmdbId: "n-portal",
    mediaType: "tv",
    title: "The Portal",
    year: 2022,
    backdrop: img("portal-arch", 800, 500),
    poster: img("portal-p", 600, 900),
    clearLogoText: "THE·PORTAL",
    tags: ["Atmos"],
    genres: ["Drama", "Sci-Fi"],
    rating: 7.2,
    votes: 57300,
    audienceScore: 72,
    criticScore: 85,
    runtime: "1h 58m",
    ageRating: "PG-13",
    overview:
      "A deep-sea research team discovers a portal to a world beneath the ocean floor. As they venture further in, the boundary between explorer and subject begins to dissolve.",
    cast: ["Lena Marsh", "Idris Côté", "Kim Park", "Robert Tan"],
    director: "Anya Volkov",
    seriesStatus: "ongoing",
    nextAirDate: "Sun 11 May",
    progress: progress(6, 12),
  },
  {
    id: "movie:n-water-lily",
    tmdbId: "n-water-lily",
    mediaType: "movie",
    title: "Water Lily",
    year: 2024,
    backdrop: img("water-lily", 800, 500),
    poster: img("waterlily-p", 600, 900),
    clearLogoText: "WATER·LILY",
    genres: ["Drama"],
    rating: 7.5,
    progress: progress(2, 10),
  },
  {
    id: "tv:after-party",
    tmdbId: "after-party",
    mediaType: "tv",
    title: "After Party",
    year: 2023,
    backdrop: img("after-party", 800, 500),
    poster: img("after-party-p", 600, 900),
    clearLogoText: "AFTER·PARTY",
    genres: ["Comedy"],
    rating: 8.3,
    votes: 41200,
    audienceScore: 88,
    criticScore: 79,
    runtime: "32m",
    ageRating: "TV-MA",
    overview:
      "An ensemble comedy set in the chaotic aftermath of a billionaire's death. Each episode follows a different guest piecing together what really happened the night before.",
    cast: ["Lena Marsh", "Idris Côté", "Kim Park"],
    director: "Seo-yeon Park",
    seriesStatus: "finished",
    progress: progress(0, 8),
  },
  {
    id: "tv:the-wake",
    tmdbId: "the-wake",
    mediaType: "tv",
    title: "The Wake",
    year: 2024,
    backdrop: img("wake-lamp", 800, 500),
    poster: img("wake-p", 600, 900),
    clearLogoText: "THE·WAKE",
    tags: ["4K"],
    genres: ["Thriller", "Drama"],
    rating: 7.9,
    votes: 29800,
    audienceScore: 81,
    criticScore: 74,
    runtime: "52m",
    ageRating: "TV-14",
    overview:
      "A lighthouse keeper on a remote island begins receiving distress signals from a vessel that sank forty years ago. A slow-burn Nordic thriller about grief and obsession.",
    cast: ["Mara Holloway", "Eitan Vasquez"],
    director: "Lars Eriksen",
    seriesStatus: "ongoing",
    nextAirDate: "Wed 7 May",
    progress: progress(3, 8),
  },
  {
    id: "tv:cardhouse",
    tmdbId: "cardhouse",
    mediaType: "tv",
    title: "Cardhouse",
    year: 2023,
    backdrop: img("cardhouse", 800, 500),
    poster: img("cardhouse-p", 600, 900),
    clearLogoText: "CARDHOUSE",
    genres: ["Drama", "Political"],
    rating: 8.0,
    votes: 63100,
    audienceScore: 84,
    criticScore: 91,
    runtime: "58m",
    ageRating: "TV-14",
    overview:
      "A veteran political strategist rebuilds her career inside a party tearing itself apart. Dense, dialogue-driven, and ruthlessly precise about how power actually works.",
    cast: ["Cassia Brandt", "Robert Tan", "Mina Seo"],
    director: "Anya Volkov",
    seriesStatus: "finished",
    progress: progress(5, 10),
  },
];

const RECOMMENDED: HomeMediaItem[] = [
  {
    id: "movie:n-marble",
    tmdbId: "n-marble",
    mediaType: "movie",
    title: "Marble Halls",
    year: 2021,
    poster: img("marble-halls", 600, 900),
    backdrop: img("marble-halls-bd", 800, 500),
    clearLogoText: "MARBLE·HALLS",
    tags: ["4K"],
    genres: ["Drama", "History"],
    rating: 8.2,
    availability: serverAvailability(["Plex"]),
  },
  {
    id: "movie:n-ember",
    tmdbId: "n-ember",
    mediaType: "movie",
    title: "Ember",
    year: 2024,
    poster: img("ember-couple", 600, 900),
    backdrop: img("ember-bd", 800, 500),
    clearLogoText: "EMBER",
    genres: ["Romance", "Drama"],
    rating: 7.6,
    status: "requested",
    availability: requestAvailability(false),
  },
  {
    id: "tv:n-gateway",
    tmdbId: "n-gateway",
    mediaType: "tv",
    title: "Gateway",
    year: 2025,
    poster: img("gateway-blue", 600, 900),
    backdrop: img("gateway-bd", 800, 500),
    clearLogoText: "GATEWAY",
    tags: ["HDR", "Atmos"],
    genres: ["Sci-Fi", "Thriller"],
    rating: 8.5,
    votes: 18900,
    audienceScore: 89,
    criticScore: 93,
    runtime: "55m",
    ageRating: "TV-14",
    overview:
      "A quantum physicist discovers her research has been used to open a one-way door. A taut sci-fi thriller about invention, consequence, and what it means to cross a threshold you can't close.",
    cast: ["Mara Holloway", "Paolo Vega", "Anika Reed"],
    director: "Yusuf Okafor",
    seriesStatus: "ongoing",
    nextAirDate: "Mon 12 May",
    status: "available",
    availability: serverAvailability(["Plex", "Jellyfin"]),
  },
  {
    id: "movie:n-hollow",
    tmdbId: "n-hollow",
    mediaType: "movie",
    title: "Hollow Path",
    year: 2023,
    poster: img("hollow-path", 600, 900),
    backdrop: img("hollow-bd", 800, 500),
    clearLogoText: "HOLLOW·PATH",
    tags: ["4K HDR", "Atmos"],
    genres: ["Thriller", "Mystery"],
    rating: 7.7,
    availability: requestAvailability(true),
  },
  {
    id: "movie:n-sunset",
    tmdbId: "n-sunset",
    mediaType: "movie",
    title: "Sunset Salvage",
    year: 2024,
    poster: img("sunset-salv", 600, 900),
    backdrop: img("sunset-bd", 800, 500),
    clearLogoText: "SUNSET",
    tags: ["HDR"],
    genres: ["Action", "Adventure"],
    rating: 7.4,
    status: "available",
    availability: serverAvailability(["Plex"]),
  },
  {
    id: "tv:n-quartz",
    tmdbId: "n-quartz",
    mediaType: "tv",
    title: "Quartz",
    year: 2022,
    poster: img("quartz-art", 600, 900),
    backdrop: img("quartz-bd", 800, 500),
    clearLogoText: "QUARTZ",
    tags: ["4K"],
    genres: ["Drama", "Crime"],
    rating: 8.1,
    votes: 47600,
    audienceScore: 85,
    criticScore: 88,
    runtime: "49m",
    ageRating: "TV-MA",
    overview:
      "A forensic accountant follows a money trail that leads back to her own family. A restrained, precisely-plotted crime drama that trusts numbers to do the work of violence.",
    cast: ["Cassia Brandt", "Idris Côté", "Kim Park"],
    director: "Lars Eriksen",
    seriesStatus: "finished",
    status: "unavailable",
    availability: requestAvailability(true),
  },
  {
    id: "movie:n-tessera",
    tmdbId: "n-tessera",
    mediaType: "movie",
    title: "Tessera",
    year: 2025,
    poster: img("tessera-art", 600, 900),
    backdrop: img("tessera-bd", 800, 500),
    clearLogoText: "TESSERA",
    tags: ["Atmos"],
    genres: ["Sci-Fi", "Mystery"],
    rating: 7.9,
    status: "requested",
    availability: requestAvailability(false),
  },
  {
    id: "movie:n-northwind",
    tmdbId: "n-northwind",
    mediaType: "movie",
    title: "Northwind",
    year: 2023,
    poster: img("northwind", 600, 900),
    backdrop: img("northwind-bd", 800, 500),
    clearLogoText: "NORTHWIND",
    tags: ["4K"],
    genres: ["Adventure", "Drama"],
    rating: 7.3,
    status: "unavailable",
    availability: requestAvailability(true),
  },
];

const BECAUSE_YOU_WATCHED: HomeMediaItem[] = [
  {
    id: "tv:n-meridian",
    tmdbId: "n-meridian",
    mediaType: "tv",
    title: "Meridian",
    year: 2024,
    poster: img("meridian", 600, 900),
    backdrop: img("meridian-bd", 800, 500),
    clearLogoText: "MERIDIAN",
    tags: ["4K", "Atmos"],
    genres: ["Thriller", "Drama"],
    rating: 8.3,
    votes: 33400,
    audienceScore: 87,
    criticScore: 90,
    runtime: "51m",
    ageRating: "TV-14",
    overview:
      "A journalist goes undercover inside a private intelligence contractor and finds the story she's been chasing is about her. A slow-burn thriller with an impeccable sense of dread.",
    cast: ["Mara Holloway", "Eitan Vasquez", "Anika Reed"],
    director: "Anya Volkov",
    seriesStatus: "ongoing",
    nextAirDate: "Sun 4 May",
    availability: serverAvailability(["Plex"]),
  },
  {
    id: "tv:n-anchor",
    tmdbId: "n-anchor",
    mediaType: "tv",
    title: "Anchor Point",
    year: 2023,
    poster: img("anchor-point", 600, 900),
    backdrop: img("anchor-bd", 800, 500),
    clearLogoText: "ANCHOR·POINT",
    tags: ["HDR"],
    genres: ["Crime", "Drama"],
    rating: 8.0,
    votes: 52100,
    audienceScore: 83,
    criticScore: 86,
    runtime: "47m",
    ageRating: "TV-MA",
    overview:
      "After a botched arrest, a homicide detective transfers to a cold-case unit and reopens a fifteen-year-old disappearance that keeps folding back on itself.",
    cast: ["Lena Marsh", "Robert Tan", "Kim Park"],
    director: "Seo-yeon Park",
    seriesStatus: "finished",
    availability: serverAvailability(["Plex"]),
  },
  {
    id: "tv:n-ledger",
    tmdbId: "n-ledger",
    mediaType: "tv",
    title: "The Ledger",
    year: 2025,
    poster: img("the-ledger", 600, 900),
    backdrop: img("ledger-bd", 800, 500),
    clearLogoText: "THE·LEDGER",
    tags: ["4K"],
    genres: ["Drama", "Finance"],
    rating: 8.2,
    votes: 27800,
    audienceScore: 86,
    criticScore: 92,
    runtime: "54m",
    ageRating: "TV-14",
    overview:
      "A mid-level analyst at a sovereign wealth fund discovers her firm has been laundering money for a decade — and that the firm knows she knows. A financial thriller in the tradition of slow-burn procedurals.",
    cast: ["Cassia Brandt", "Paolo Vega"],
    director: "Lars Eriksen",
    seriesStatus: "ongoing",
    nextAirDate: "Tue 6 May",
    availability: serverAvailability(["Jellyfin"]),
  },
  {
    id: "tv:n-pale",
    tmdbId: "n-pale",
    mediaType: "tv",
    title: "Pale Light",
    year: 2022,
    poster: img("pale-light", 600, 900),
    backdrop: img("pale-bd", 800, 500),
    clearLogoText: "PALE·LIGHT",
    tags: ["Atmos"],
    genres: ["Horror", "Mystery"],
    rating: 7.8,
    votes: 38700,
    audienceScore: 78,
    criticScore: 71,
    runtime: "44m",
    ageRating: "TV-MA",
    overview:
      "A grief counselor moves to a coastal town and begins noticing that her new clients are describing the same recurring dream. Atmospheric and genuinely unsettling.",
    cast: [
      "Lena Marsh",
      "Idris Côté",
      "Kim Park",
      "Robert Tan",
      "Mina Seo",
      "Paolo Vega",
      "Anika Reed",
    ],
    director: "Anya Volkov",
    seriesStatus: "finished",
    availability: requestAvailability(true),
  },
  {
    id: "tv:n-lantern",
    tmdbId: "n-lantern",
    mediaType: "tv",
    title: "Lantern",
    year: 2024,
    poster: img("lantern-set", 600, 900),
    backdrop: img("lantern-bd", 800, 500),
    clearLogoText: "LANTERN",
    tags: ["4K HDR"],
    genres: ["Drama", "Indie"],
    rating: 7.6,
    votes: 19300,
    audienceScore: 80,
    criticScore: 77,
    runtime: "38m",
    ageRating: "TV-14",
    overview:
      "An indie drama about a small community theatre company rehearsing a play no one fully understands. Quiet, observational, and unexpectedly moving.",
    cast: ["Mara Holloway", "Eitan Vasquez"],
    director: "Seo-yeon Park",
    seriesStatus: "ongoing",
    nextAirDate: "Fri 9 May",
    availability: serverAvailability(["Plex"]),
  },
  {
    id: "tv:n-orchard",
    tmdbId: "n-orchard",
    mediaType: "tv",
    title: "The Orchard",
    year: 2025,
    poster: img("orchard-set", 600, 900),
    backdrop: img("orchard-bd", 800, 500),
    clearLogoText: "ORCHARD",
    tags: ["4K"],
    genres: ["Drama", "Family"],
    rating: 8.1,
    votes: 22600,
    audienceScore: 85,
    criticScore: 88,
    runtime: "56m",
    ageRating: "TV-PG",
    overview:
      "Three generations of a farming family converge on the family estate after the patriarch announces he intends to sell. A patient, character-driven drama about inheritance and what gets left unsaid.",
    cast: ["Cassia Brandt", "Robert Tan", "Anika Reed"],
    director: "Yusuf Okafor",
    seriesStatus: "ongoing",
    nextAirDate: "Thu 8 May",
    availability: serverAvailability(["Plex"]),
  },
  {
    id: "tv:n-still",
    tmdbId: "n-still",
    mediaType: "tv",
    title: "Still Hours",
    year: 2024,
    poster: img("still-hours", 600, 900),
    backdrop: img("still-bd", 800, 500),
    clearLogoText: "STILL·HOURS",
    tags: ["HDR"],
    genres: ["Drama"],
    rating: 7.9,
    votes: 15800,
    audienceScore: 82,
    criticScore: 79,
    runtime: "43m",
    ageRating: "TV-14",
    overview:
      "A sound engineer documenting the last residents of a dying mountain town finds the recordings taking on a life of their own. An elusive, formally inventive drama.",
    cast: ["Lena Marsh", "Kim Park"],
    director: "Lars Eriksen",
    seriesStatus: "finished",
    availability: serverAvailability(["Plex"]),
  },
];

const TRENDING: HomeMediaItem[] = [
  {
    id: "movie:t-1",
    tmdbId: "t-1",
    mediaType: "movie",
    title: "Paper Crown",
    year: 2025,
    backdrop: img("paper-crown", 800, 500),
    poster: img("paper-crown-p", 600, 900),
    clearLogoText: "PAPER·CROWN",
    tags: ["4K HDR", "Atmos"],
    genres: ["Drama", "History"],
    rating: 8.4,
    availability: requestAvailability(true),
  },
  {
    id: "movie:t-2",
    tmdbId: "t-2",
    mediaType: "movie",
    title: "Cradle",
    year: 2024,
    backdrop: img("cradle", 800, 500),
    poster: img("cradle-p", 600, 900),
    clearLogoText: "CRADLE",
    tags: ["4K"],
    genres: ["Drama", "Thriller"],
    rating: 8.0,
    availability: serverAvailability(["Plex"]),
  },
  {
    id: "tv:t-3",
    tmdbId: "t-3",
    mediaType: "tv",
    title: "Northbound",
    year: 2025,
    backdrop: img("northbound", 800, 500),
    poster: img("northbound-p", 600, 900),
    clearLogoText: "NORTHBOUND",
    tags: ["HDR"],
    genres: ["Adventure", "Drama"],
    rating: 8.2,
    votes: 31200,
    audienceScore: 86,
    criticScore: 89,
    runtime: "53m",
    ageRating: "TV-14",
    overview:
      "A cartographer hired to map a disputed Arctic region quickly realises the disagreement runs deeper than any border. Sweeping landscape photography, measured pace, earned emotion.",
    cast: ["Mara Holloway", "Paolo Vega", "Kim Park"],
    director: "Lars Eriksen",
    seriesStatus: "ongoing",
    nextAirDate: "Sat 10 May",
    availability: serverAvailability(["Jellyfin"]),
  },
  {
    id: "movie:t-4",
    tmdbId: "t-4",
    mediaType: "movie",
    title: "Field Notes",
    year: 2024,
    backdrop: img("field-notes", 800, 500),
    poster: img("field-notes-p", 600, 900),
    clearLogoText: "FIELD·NOTES",
    tags: ["Atmos"],
    genres: ["Documentary", "Drama"],
    rating: 7.9,
    availability: requestAvailability(true),
  },
  {
    id: "movie:t-5",
    tmdbId: "t-5",
    mediaType: "movie",
    title: "Vantage",
    year: 2024,
    backdrop: img("vantage", 800, 500),
    poster: img("vantage-p", 600, 900),
    clearLogoText: "VANTAGE",
    tags: ["4K HDR"],
    genres: ["Thriller", "Action"],
    rating: 7.7,
    status: "available",
    availability: serverAvailability(["Plex", "Jellyfin"]),
  },
  {
    id: "tv:t-6",
    tmdbId: "t-6",
    mediaType: "tv",
    title: "Long Wave",
    year: 2023,
    backdrop: img("long-wave", 800, 500),
    poster: img("long-wave-p", 600, 900),
    clearLogoText: "LONG·WAVE",
    tags: ["4K"],
    genres: ["Drama", "Crime"],
    rating: 8.1,
    votes: 43500,
    audienceScore: 84,
    criticScore: 87,
    runtime: "50m",
    ageRating: "TV-14",
    overview:
      "A retired cryptographer is recruited to decode transmissions intercepted from a criminal network — only to recognise her own daughter's voice in the recordings.",
    cast: ["Cassia Brandt", "Idris Côté", "Mina Seo"],
    director: "Anya Volkov",
    seriesStatus: "finished",
    availability: serverAvailability(["Plex"]),
  },
  {
    id: "movie:t-7",
    tmdbId: "t-7",
    mediaType: "movie",
    title: "Switchback",
    year: 2025,
    backdrop: img("switchback", 800, 500),
    poster: img("switchback-p", 600, 900),
    clearLogoText: "SWITCHBACK",
    tags: ["4K HDR"],
    genres: ["Action", "Thriller"],
    rating: 7.6,
    availability: requestAvailability(true),
  },
];

function withOverrides(
  item: HomeMediaItem,
  overrides: Partial<HomeMediaItem> & {
    matchReasonKey?: MatchReasonKey;
    matchReasonParams?: Record<string, string>;
  },
): HomeMediaItem {
  return { ...item, ...overrides };
}

const CONTINUE_WATCHING: HomeMediaItem[] = ALSO_WATCHING.map((item, idx) =>
  withOverrides(item, {
    availability:
      idx === 1 ? serverAvailability(["Plex", "Jellyfin"]) : serverAvailability(["Plex"]),
    matchReasonKey: idx === 2 ? "finishing_soon" : "matches_recent_picks",
    matchReasonParams: idx === 2 ? {} : { n: "4" },
    facets: { runtimeMin: item.mediaType === "tv" ? 48 : 116 },
  }),
);

const BECAUSE_FINISHED: HomeMediaItem[] = BECAUSE_YOU_WATCHED.map((item, idx) =>
  withOverrides(item, {
    availability:
      idx === 3
        ? requestAvailability(true)
        : serverAvailability(idx === 2 ? ["Jellyfin"] : ["Plex"]),
    matchReasonKey: idx === 1 ? "from_genre_you_love" : "similar_to_seed",
    matchReasonParams: idx === 1 ? { genre: "police procedural" } : { seedTitle: "Helios Run" },
    facets: { runtimeMin: 52, episodeCount: item.mediaType === "tv" ? 8 + idx : undefined },
    progress: undefined,
  }),
);

const NEXT_EPISODE_ACTIVE_SERIES: HomeMediaItem[] = [
  withOverrides(RECOMMENDED[2]!, {
    progress: undefined,
    availability: serverAvailability(["Plex", "Jellyfin"]),
    seriesContext: { season: 2, episode: 4, episodeTitle: "Long Wave", nextUpFromServer: true },
    matchReasonKey: "from_active_series",
    matchReasonParams: {},
    facets: { runtimeMin: 51, episodeCount: 10 },
  }),
  withOverrides(BECAUSE_YOU_WATCHED[0]!, {
    progress: undefined,
    availability: serverAvailability(["Plex"]),
    seriesContext: { season: 1, episode: 7, episodeTitle: "Threshold", nextUpFromServer: true },
    matchReasonKey: "continuing_series",
    matchReasonParams: {},
    facets: { runtimeMin: 46, episodeCount: 8 },
  }),
  withOverrides(BECAUSE_YOU_WATCHED[2]!, {
    progress: undefined,
    availability: serverAvailability(["Jellyfin"]),
    seriesContext: { season: 1, episode: 5, episodeTitle: "The Inventory", nextUpFromServer: true },
    matchReasonKey: "from_active_series",
    matchReasonParams: {},
    facets: { runtimeMin: 54, episodeCount: 9 },
  }),
  withOverrides(ALSO_WATCHING[4]!, {
    progress: undefined,
    availability: serverAvailability(["Plex"]),
    seriesContext: { season: 2, episode: 3, episodeTitle: "Winter Garden", nextUpFromServer: true },
    matchReasonKey: "continuing_series",
    matchReasonParams: {},
    facets: { runtimeMin: 44, episodeCount: 8 },
  }),
];

const WATCHLIST_NOW_AVAILABLE: HomeMediaItem[] = [
  withOverrides(RECOMMENDED[4]!, {
    progress: undefined,
    availability: serverAvailability(["Plex"]),
    matchReasonKey: "because_in_watchlist",
    matchReasonParams: {},
    facets: { runtimeMin: 101 },
  }),
  withOverrides(RECOMMENDED[3]!, {
    progress: undefined,
    availability: serverAvailability(["Jellyfin"]),
    matchReasonKey: "recently_added",
    matchReasonParams: {},
    facets: { runtimeMin: 124 },
  }),
  withOverrides(TRENDING[4]!, {
    progress: undefined,
    availability: serverAvailability(["Plex", "Jellyfin"]),
    matchReasonKey: "because_in_watchlist",
    matchReasonParams: {},
    facets: { runtimeMin: 109 },
  }),
  withOverrides(TRENDING[0]!, {
    progress: undefined,
    availability: serverAvailability(["Plex"]),
    matchReasonKey: "highly_rated",
    matchReasonParams: {},
    facets: { runtimeMin: 132 },
  }),
];

const UPCOMING_FOR_YOU: HomeMediaItem[] = [
  {
    id: "tv:drama-01",
    tmdbId: "drama-01",
    mediaType: "tv",
    title: "The Drama",
    year: 2025,
    backdrop: img("drama-city", 800, 600),
    clearLogoText: "THE·DRAMA",
    genres: ["Drama"],
    rating: 7.5,
    availability: requestAvailability(false),
    seriesContext: { season: 1, episode: 1, episodeTitle: "Pilot", nextUpFromServer: false },
    matchReasonKey: "upcoming_release",
    matchReasonParams: {},
    facets: { runtimeMin: 48, episodeCount: 10, releaseDate: "Tomorrow" },
  },
  {
    id: "tv:long-walk",
    tmdbId: "long-walk",
    mediaType: "tv",
    title: "The Long Walk",
    year: 2024,
    backdrop: img("walk-park", 800, 600),
    clearLogoText: "LONG·WALK",
    genres: ["Drama", "Sci-Fi"],
    rating: 8.0,
    availability: requestAvailability(false),
    seriesContext: {
      season: 2,
      episode: 5,
      episodeTitle: "Borrowed Time",
      nextUpFromServer: false,
    },
    matchReasonKey: "upcoming_release",
    matchReasonParams: {},
    facets: { runtimeMin: 48, episodeCount: 10, releaseDate: "Next Friday" },
  },
  {
    id: "tv:halcyon",
    tmdbId: "halcyon",
    mediaType: "tv",
    title: "Halcyon",
    year: 2023,
    backdrop: img("halcyon-paint", 800, 600),
    clearLogoText: "HALCYON",
    genres: ["Drama", "Fantasy"],
    rating: 7.8,
    availability: requestAvailability(false),
    seriesContext: {
      season: 3,
      episode: 3,
      episodeTitle: "The Glass Mile",
      nextUpFromServer: false,
    },
    matchReasonKey: "upcoming_release",
    matchReasonParams: {},
    facets: { runtimeMin: 48, episodeCount: 10, releaseDate: "In 5 days" },
  },
  {
    id: "tv:sovereigns",
    tmdbId: "sovereigns",
    mediaType: "tv",
    title: "Sovereigns",
    year: 2024,
    backdrop: img("sov-monument", 800, 600),
    clearLogoText: "SOVEREIGNS",
    genres: ["History", "Drama"],
    rating: 8.3,
    availability: requestAvailability(false),
    seriesContext: { season: 4, episode: 2, episodeTitle: "Salt", nextUpFromServer: false },
    matchReasonKey: "upcoming_release",
    matchReasonParams: {},
    facets: { runtimeMin: 48, episodeCount: 10, releaseDate: "Thu 12 May" },
  },
];

const TV_NEEDS_REQUEST: HomeMediaItem[] = [
  withOverrides(RECOMMENDED[5]!, {
    progress: undefined,
    availability: requestAvailability(true),
    matchReasonKey: "matches_recent_picks",
    matchReasonParams: { n: "4" },
    facets: { runtimeMin: 48, episodeCount: 12 },
  }),
  withOverrides(
    { ...BECAUSE_YOU_WATCHED[3]!, status: "unavailable" },
    {
      progress: undefined,
      availability: requestAvailability(true),
      matchReasonKey: "from_genre_you_love",
      matchReasonParams: { genre: "atmospheric horror" },
      facets: { runtimeMin: 52, episodeCount: 11 },
    },
  ),
  {
    id: "tv:n-cinder",
    tmdbId: "n-cinder",
    mediaType: "tv",
    title: "Cinder Coast",
    year: 2024,
    poster: img("cinder-coast-p", 600, 900),
    backdrop: img("cinder-coast-bd", 800, 500),
    status: "unavailable",
    clearLogoText: "CINDER·COAST",
    tags: ["HDR"],
    genres: ["Drama", "Thriller"],
    rating: 7.7,
    votes: 24100,
    audienceScore: 79,
    criticScore: 76,
    runtime: "46m",
    ageRating: "TV-14",
    overview:
      "A coastal town's arson investigator is pulled into a decades-old land dispute when a series of fires begins following the exact same pattern as a case her predecessor never solved.",
    cast: ["Lena Marsh", "Robert Tan"],
    director: "Seo-yeon Park",
    seriesStatus: "ongoing",
    nextAirDate: "Thu 15 May",
    availability: requestAvailability(true),
    matchReasonKey: "similar_to_seed",
    matchReasonParams: { seedTitle: "Helios Run" },
    facets: { runtimeMin: 46, episodeCount: 8 },
  },
  {
    id: "tv:n-borderline",
    tmdbId: "n-borderline",
    mediaType: "tv",
    title: "Borderline Archive",
    year: 2023,
    poster: img("borderline-archive-p", 600, 900),
    backdrop: img("borderline-archive-bd", 800, 500),
    status: "unavailable",
    clearLogoText: "BORDERLINE",
    tags: ["4K"],
    genres: ["Crime", "Thriller"],
    rating: 8.0,
    votes: 36200,
    audienceScore: 83,
    criticScore: 85,
    runtime: "50m",
    ageRating: "TV-MA",
    overview:
      "An archivist at a national records office starts finding documents that prove crimes the government insists never happened. A methodical, archive-procedural thriller.",
    cast: ["Mara Holloway", "Eitan Vasquez", "Kim Park"],
    director: "Lars Eriksen",
    seriesStatus: "finished",
    availability: requestAvailability(true),
    matchReasonKey: "from_genre_you_love",
    matchReasonParams: { genre: "quiet thrillers" },
    facets: { runtimeMin: 50, episodeCount: 10 },
  },
  {
    id: "tv:n-lowlands",
    tmdbId: "n-lowlands",
    mediaType: "tv",
    title: "Lowlands",
    year: 2025,
    poster: img("lowlands-p", 600, 900),
    backdrop: img("lowlands-bd", 800, 500),
    status: "unavailable",
    clearLogoText: "LOWLANDS",
    tags: ["Atmos"],
    genres: ["Drama", "Mystery"],
    rating: 7.9,
    votes: 17600,
    audienceScore: 81,
    criticScore: 84,
    runtime: "54m",
    ageRating: "TV-14",
    overview:
      "Following her husband's unexplained departure, a woman moves to her estranged mother's house in the Dutch lowlands — and begins piecing together a history both families agreed to forget.",
    cast: ["Cassia Brandt", "Idris Côté"],
    director: "Anya Volkov",
    seriesStatus: "ongoing",
    nextAirDate: "Tue 13 May",
    availability: requestAvailability(true),
    matchReasonKey: "highly_rated",
    matchReasonParams: {},
    facets: { runtimeMin: 54, episodeCount: 9 },
  },
];

const MOVIES_NEEDS_REQUEST: HomeMediaItem[] = [
  withOverrides(RECOMMENDED[7]!, {
    progress: undefined,
    availability: requestAvailability(true),
    matchReasonKey: "matches_recent_picks",
    matchReasonParams: { n: "4" },
    facets: { runtimeMin: 112 },
  }),
  {
    id: "movie:n-briar",
    tmdbId: "n-briar",
    mediaType: "movie",
    title: "Briar Signal",
    year: 2024,
    poster: img("briar-signal-p", 600, 900),
    backdrop: img("briar-signal-bd", 800, 500),
    status: "unavailable",
    clearLogoText: "BRIAR·SIGNAL",
    tags: ["4K"],
    genres: ["Thriller", "Mystery"],
    rating: 7.8,
    availability: requestAvailability(true),
    matchReasonKey: "similar_to_seed",
    matchReasonParams: { seedTitle: "Aurora Drift" },
    facets: { runtimeMin: 119 },
  },
  {
    id: "movie:n-lumen",
    tmdbId: "n-lumen",
    mediaType: "movie",
    title: "Lumen Yard",
    year: 2022,
    poster: img("lumen-yard-p", 600, 900),
    backdrop: img("lumen-yard-bd", 800, 500),
    status: "unavailable",
    clearLogoText: "LUMEN·YARD",
    tags: ["HDR"],
    genres: ["Drama", "Thriller"],
    rating: 7.5,
    availability: requestAvailability(true),
    matchReasonKey: "from_genre_you_love",
    matchReasonParams: { genre: "quiet thrillers" },
    facets: { runtimeMin: 104 },
  },
  {
    id: "movie:n-afterimage",
    tmdbId: "n-afterimage",
    mediaType: "movie",
    title: "Afterimage Mile",
    year: 2025,
    poster: img("afterimage-mile-p", 600, 900),
    backdrop: img("afterimage-mile-bd", 800, 500),
    status: "unavailable",
    clearLogoText: "AFTERIMAGE",
    tags: ["Atmos"],
    genres: ["Drama", "Art"],
    rating: 8.1,
    availability: requestAvailability(true),
    matchReasonKey: "highly_rated",
    matchReasonParams: {},
    facets: { runtimeMin: 127 },
  },
  {
    id: "movie:n-glassfield",
    tmdbId: "n-glassfield",
    mediaType: "movie",
    title: "Glassfield",
    year: 2023,
    poster: img("glassfield-p", 600, 900),
    backdrop: img("glassfield-bd", 800, 500),
    status: "unavailable",
    clearLogoText: "GLASSFIELD",
    tags: ["4K HDR"],
    genres: ["Sci-Fi", "Drama"],
    rating: 7.6,
    availability: requestAvailability(true),
    matchReasonKey: "recently_added",
    matchReasonParams: {},
    facets: { runtimeMin: 116 },
  },
];

const heroAlternates: HomeMediaItem[] = [
  withOverrides(RECOMMENDED[4]!, {
    progress: undefined,
    availability: serverAvailability(["Plex"]),
    matchReasonKey: "recently_added",
    matchReasonParams: {},
    facets: { runtimeMin: 101 },
  }),
  withOverrides(RECOMMENDED[0]!, {
    progress: undefined,
    availability: serverAvailability(["Jellyfin"]),
    matchReasonKey: "similar_to_seed",
    matchReasonParams: { seedTitle: "Aurora Drift" },
    facets: { runtimeMin: 128 },
  }),
  withOverrides(TRENDING[1]!, {
    progress: undefined,
    availability: serverAvailability(["Plex"]),
    matchReasonKey: "highly_rated",
    matchReasonParams: {},
    facets: { runtimeMin: 117 },
  }),
  withOverrides(TRENDING[2]!, {
    progress: undefined,
    availability: serverAvailability(["Jellyfin"]),
    seriesContext: { season: 1, episode: 2, episodeTitle: "First Light", nextUpFromServer: false },
    matchReasonKey: "from_genre_you_love",
    matchReasonParams: { genre: "quiet thrillers" },
    facets: { runtimeMin: 47, episodeCount: 8 },
  }),
  withOverrides(RECOMMENDED[6]!, {
    progress: undefined,
    availability: requestAvailability(true),
    matchReasonKey: "matches_recent_picks",
    matchReasonParams: { n: "5" },
    facets: { runtimeMin: 122 },
  }),
];

export const MOCK_HERO: HeroItem = {
  id: "movie:n-aurora",
  tmdbId: "n-aurora",
  mediaType: "movie",
  title: "Aurora Drift",
  year: 2024,
  runtime: "2h 14m",
  ageRating: "PG-13",
  genres: ["Sci-Fi", "Drama", "Mystery"],
  overview:
    "An atmospheric sci-fi descent into the silence between stars. A salvage pilot follows a derelict signal toward the edge of the heliosphere — and finds something already waiting.",
  backdrop: img("aurora-bd", 1600, 900),
  poster: img("aurora-poster", 600, 900),
  clearLogoText: "AURORA·DRIFT",
  progress: progress(42, 100),
  matchReasonKey: "similar_to_seed",
  matchReasonParams: { seedTitle: "Helios Run" },
  availability: serverAvailability(["Plex"]),
  facets: { runtimeMin: 134, monochrome: false, releaseDate: "2024-11-18" },
  rating: 8.4,
  votes: 24180,
  audienceScore: 92,
  criticScore: 87,
  cast: ["Mara Holloway", "Eitan Vasquez", "Ren Ito", "Cassia Brandt"],
  director: "Yusuf Okafor",
  tags: ["4K HDR", "Atmos"],
  trailerUrl: "#",
  alternates: heroAlternates,
};

function makeRow(
  id: string,
  kind: RowKind,
  items: HomeMediaItem[],
  extra?: Partial<Omit<RowData, "id" | "kind" | "items" | "defaultAspect">>,
): RowData {
  return { id, kind, items, defaultAspect: ROW_ASPECT[kind], ...extra };
}

/** Mock rows mapped from prototype demo data to shared RowKind values. */
export const MOCK_ROWS: RowData[] = [
  makeRow("continueWatching", "continueWatching", CONTINUE_WATCHING),
  makeRow("becauseYouWatched", "becauseYouWatched", BECAUSE_FINISHED, { seedTitle: "Helios Run" }),
  makeRow("continueWatching-2", "continueWatching", NEXT_EPISODE_ACTIVE_SERIES, {
    headerKey: "home_row_nextInYourShows_header",
    subtitleKey: "home_row_nextInYourShows_subtitle",
  }),
  makeRow("recommendedForYou-tv", "recommendedForYou", TV_NEEDS_REQUEST, {
    headerKey: "home_row_tvShowsToRequest_header",
  }),
  makeRow("recommendedForYou-movies", "recommendedForYou", MOVIES_NEEDS_REQUEST, {
    headerKey: "home_row_moviesToRequest_header",
  }),
  makeRow("yourWatchlist", "yourWatchlist", WATCHLIST_NOW_AVAILABLE),
  makeRow("upcomingForYou", "upcomingForYou", UPCOMING_FOR_YOU),
];

const EP_TITLES = [
  "Cold Open",
  "First Light",
  "The Quiet Year",
  "Anchor",
  "Long Wave",
  "Glass House",
  "Threshold",
  "The Inventory",
  "Borrowed Time",
  "Static",
  "North",
  "Lantern",
  "Paper Crowns",
  "Winter Garden",
  "The Mistake",
  "Salt",
  "Backwater",
  "Fieldwork",
  "Drift",
  "Hollows",
  "Switchback",
  "Marbles",
  "The Ledger",
  "Pale Light",
];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// XOR-shift RNG seeded by a string hash, identical to the prototype's _hash/_rng.
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

// Deterministic mock seasons + full episode data for any TV item.
// Mirrors the prototype's generateSeasons logic so the modal content
// matches the reference design.
function mockSeasonsForId(
  id: string,
  status: HomeMediaItem["status"],
  seriesStatus: HomeMediaItem["seriesStatus"],
): MockSeason[] {
  const seed = strHash(id);
  const rnd = makeRng(seed);
  const ongoing = seriesStatus === "ongoing";
  const seasonCount = ongoing ? 2 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 4);

  const baseBias =
    status === "available"
      ? 0.85
      : status === "requested"
        ? 0.15
        : status === "unavailable"
          ? 0.05
          : 0.55;

  const seasons: MockSeason[] = [];
  let titleIdx = Math.floor(rnd() * EP_TITLES.length);

  for (let s = 1; s <= seasonCount; s++) {
    const episodeCount = 6 + Math.floor(rnd() * 6);
    const isLatest = s === seasonCount;
    const aired =
      ongoing && isLatest ? Math.max(1, Math.floor(rnd() * episodeCount * 0.7) + 1) : episodeCount;
    const seasonBias = ongoing && isLatest ? Math.min(baseBias, 0.4) : baseBias;

    const episodes: MockEpisode[] = [];
    for (let e = 1; e <= episodeCount; e++) {
      let epStatus: MockEpisodeStatus;
      if (e > aired) {
        epStatus = "upcoming";
      } else {
        const r = rnd();
        if (r < seasonBias) epStatus = "available";
        else if (r < seasonBias + 0.18) epStatus = "requested";
        else epStatus = "unavailable";
      }

      const airDate =
        epStatus === "upcoming"
          ? `In ${1 + Math.floor(rnd() * 21)} days`
          : `${MONTHS[Math.floor(rnd() * 12)]} ${1 + Math.floor(rnd() * 28)}, ${2020 + s}`;

      episodes.push({
        id: `${id}:s${s}e${e}`,
        episode: e,
        title: EP_TITLES[titleIdx % EP_TITLES.length]!,
        runtime: 38 + Math.floor(rnd() * 22),
        airDate,
        status: epStatus,
      });
      titleIdx++;
    }

    const counts = episodes.reduce<Partial<Record<MockEpisodeStatus, number>>>((acc, ep) => {
      acc[ep.status] = (acc[ep.status] ?? 0) + 1;
      return acc;
    }, {});

    seasons.push({ number: s, episodeCount, counts, episodes });
  }
  return seasons;
}

function withMockSeasons<T extends HomeMediaItem>(item: T): T {
  if (item.mediaType !== "tv" || item.seasons) return item;
  return {
    ...item,
    seasons: mockSeasonsForId(item.id, item.status, item.seriesStatus),
  };
}

function decorateTvSeasons<T extends HomeMediaItem>(items: T[]): T[] {
  return items.map(withMockSeasons);
}

export const MOCK_FEED: HomeFeedData = {
  hero: { ...MOCK_HERO, alternates: decorateTvSeasons(MOCK_HERO.alternates) },
  rows: MOCK_ROWS.map((row) => ({ ...row, items: decorateTvSeasons(row.items) })),
};
