export interface PosterTitle {
  title: string;
  tag: string;
  genre: string;
}

export const POSTER_TITLES: readonly PosterTitle[] = [
  { title: "Midnight Atlas", tag: "S2 · LIMITED", genre: "drama" },
  { title: "Crown of Echoes", tag: "FILM · 2026", genre: "epic" },
  { title: "Black Harbor", tag: "S1 · NEW", genre: "thriller" },
  { title: "Last Light", tag: "FILM", genre: "drama" },
  { title: "Vapor", tag: "S3", genre: "scifi" },
  { title: "The Quiet Year", tag: "DOC", genre: "doc" },
  { title: "Silver Tide", tag: "S1", genre: "drama" },
  { title: "Hollow Crown", tag: "MINI", genre: "epic" },
  { title: "Northwind", tag: "FILM", genre: "western" },
  { title: "Cinder", tag: "S2", genre: "fantasy" },
  { title: "Salt & Bone", tag: "FILM · NEW", genre: "drama" },
  { title: "Magnolia Street", tag: "S4", genre: "comedy" },
  { title: "Distant Shore", tag: "FILM", genre: "drama" },
  { title: "Paper Wolves", tag: "S1", genre: "thriller" },
  { title: "Glass House", tag: "DOC", genre: "doc" },
  { title: "Lantern", tag: "FILM", genre: "fantasy" },
  { title: "Argent", tag: "S2 · FINAL", genre: "scifi" },
  { title: "Embers", tag: "FILM", genre: "drama" },
  { title: "Pale Horse", tag: "MINI", genre: "western" },
  { title: "Solstice", tag: "S3", genre: "fantasy" },
  { title: "The Ferryman", tag: "FILM", genre: "thriller" },
  { title: "Vermillion", tag: "S1 · NEW", genre: "drama" },
  { title: "Static", tag: "FILM", genre: "scifi" },
  { title: "Iron & Ash", tag: "MINI", genre: "epic" },
  { title: "Lowlands", tag: "S2", genre: "western" },
  { title: "Verge", tag: "FILM", genre: "scifi" },
  { title: "Coda", tag: "S1", genre: "drama" },
  { title: "Specter", tag: "FILM", genre: "thriller" },
  { title: "Halcyon", tag: "S5 · FINAL", genre: "comedy" },
  { title: "Phantom Coast", tag: "FILM", genre: "drama" },
  { title: "Wildwood", tag: "DOC", genre: "doc" },
  { title: "The Cartographer", tag: "S1", genre: "epic" },
  { title: "Bluebird", tag: "FILM", genre: "comedy" },
  { title: "Marrow", tag: "S2", genre: "thriller" },
  { title: "Saint of Knives", tag: "FILM · NEW", genre: "western" },
  { title: "Tidewater", tag: "MINI", genre: "drama" },
  { title: "Oracle", tag: "S3 · FINAL", genre: "scifi" },
  { title: "Hemlock", tag: "FILM", genre: "fantasy" },
  { title: "After the Fall", tag: "S1", genre: "drama" },
  { title: "Greyhound Year", tag: "DOC", genre: "doc" },
  { title: "Cosmonaut", tag: "FILM", genre: "scifi" },
  { title: "Velvet Knife", tag: "S2", genre: "thriller" },
  { title: "The Cardinal", tag: "MINI", genre: "epic" },
  { title: "Driftwood", tag: "FILM", genre: "drama" },
  { title: "Marigold", tag: "S3", genre: "comedy" },
  { title: "Riverbone", tag: "FILM", genre: "western" },
  { title: "Glasswing", tag: "S1 · NEW", genre: "fantasy" },
  { title: "Hollowtide", tag: "FILM", genre: "thriller" },
];

export interface PosterPosition {
  insetBlockStart: string;
  insetBlockEnd: string;
  insetInlineStart: string;
  insetInlineEnd: string;
  textAlign: "left" | "right" | "center";
  transform?: string;
}

export const POSTER_POSITIONS: readonly PosterPosition[] = [
  {
    insetBlockStart: "auto",
    insetBlockEnd: "8%",
    insetInlineStart: "8%",
    insetInlineEnd: "8%",
    textAlign: "left",
  },
  {
    insetBlockStart: "8%",
    insetBlockEnd: "auto",
    insetInlineStart: "8%",
    insetInlineEnd: "8%",
    textAlign: "left",
  },
  {
    insetBlockStart: "50%",
    insetBlockEnd: "auto",
    insetInlineStart: "8%",
    insetInlineEnd: "8%",
    textAlign: "center",
    transform: "translateY(-50%)",
  },
  {
    insetBlockStart: "auto",
    insetBlockEnd: "8%",
    insetInlineStart: "8%",
    insetInlineEnd: "8%",
    textAlign: "center",
  },
  {
    insetBlockStart: "auto",
    insetBlockEnd: "8%",
    insetInlineStart: "8%",
    insetInlineEnd: "8%",
    textAlign: "right",
  },
  {
    insetBlockStart: "50%",
    insetBlockEnd: "auto",
    insetInlineStart: "8%",
    insetInlineEnd: "8%",
    textAlign: "left",
    transform: "translateY(-50%)",
  },
];

// Row config: 6 rows alternate direction, vary speed and scale for depth.
export const ROW_CONFIG = [
  { baseSpeed: 120, direction: 1, scale: 0.85 },
  { baseSpeed: 90, direction: -1, scale: 1.0 },
  { baseSpeed: 140, direction: 1, scale: 0.95 },
  { baseSpeed: 100, direction: -1, scale: 1.05 },
  { baseSpeed: 130, direction: 1, scale: 0.95 },
  { baseSpeed: 110, direction: -1, scale: 1.0 },
] as const;

export const ROW_POSTER_COUNT = 14;
// Speed multiplier baked from the original mock (baseSpeed / 0.2 => slow drift).
export const ROW_SPEED_DIVISOR = 0.2;

// FNV-1a 32-bit hash for deterministic per-seed pseudo-random values.
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface PosterStyle {
  position: PosterPosition;
  displayTitle: string;
  fontFamily: string;
  fontWeight: number;
  letterSpacing: string;
  fontStyle: "italic" | "normal";
  posterSurface: string;
}

// Resolves every per-poster style decision from a deterministic seed. Pulled
// out of the component so the render path stays cheap and so the math can be
// covered by tests if it ever grows further.
// fallow-ignore-next-line complexity
export function derivePosterStyle(title: string, idx: number): PosterStyle {
  const seed = title + idx;
  const titleStyle = hash(seed + "t") % 4;
  const baseHue = hash(seed + "h") % 360;
  const accentHue = (baseHue + 40) % 360;
  const isUpper = titleStyle === 0 || titleStyle === 2;
  const layoutVariant = hash(seed + "l") % POSTER_POSITIONS.length;

  return {
    position: POSTER_POSITIONS[layoutVariant] ?? POSTER_POSITIONS[0]!,
    displayTitle: isUpper ? title.toUpperCase() : title,
    fontFamily: titleStyle === 1 ? "var(--font-sans)" : "var(--font-serif)",
    fontWeight: titleStyle === 1 ? 800 : 900,
    letterSpacing: isUpper ? "0.02em" : "-0.02em",
    fontStyle: titleStyle === 3 ? "italic" : "normal",
    posterSurface: `linear-gradient(135deg, oklch(0.35 0.12 ${baseHue}) 0%, oklch(0.22 0.08 ${accentHue}) 60%, oklch(0.12 0.04 ${baseHue}) 100%)`,
  };
}
