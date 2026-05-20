import * as React from "react";

const POSTER_TITLES = [
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
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface PosterData {
  title: string;
  tag: string;
  genre: string;
}

interface PosterProps {
  data: PosterData;
  idx: number;
}

const Poster = React.memo(function Poster({ data, idx }: PosterProps) {
  const seed = data.title + idx;

  const layoutVariant = hash(seed + "l") % 6;
  const titleStyle = hash(seed + "t") % 4;
  const tintHue = hash(seed + "h") % 360;

  const isUpper = titleStyle === 0 || titleStyle === 2;
  const displayTitle = isUpper ? data.title.toUpperCase() : data.title;
  const fontFamily = titleStyle === 1 ? "var(--font-sans)" : "var(--font-serif)";
  const fontWeight = titleStyle === 1 ? 800 : 900;
  const letterSpacing = isUpper ? "0.02em" : "-0.02em";
  const fontStyle = titleStyle === 3 ? "italic" : "normal";

  const imgSeed = encodeURIComponent("lumen-" + data.title.replace(/\s+/g, "-").toLowerCase());
  const imgUrl = `https://picsum.photos/seed/${imgSeed}/320/480`;

  const positions = [
    { top: "auto", bottom: "8%", left: "8%", right: "8%", textAlign: "left" },
    { top: "8%", bottom: "auto", left: "8%", right: "8%", textAlign: "left" },
    {
      top: "50%",
      bottom: "auto",
      left: "8%",
      right: "8%",
      textAlign: "center",
      transform: "translateY(-50%)",
    },
    { top: "auto", bottom: "8%", left: "8%", right: "8%", textAlign: "center" },
    { top: "auto", bottom: "8%", left: "8%", right: "8%", textAlign: "right" },
    {
      top: "50%",
      bottom: "auto",
      left: "8%",
      right: "8%",
      textAlign: "left",
      transform: "translateY(-50%)",
    },
  ] as const;

  const pos = positions[layoutVariant];

  return (
    <div className="poster">
      <img
        className="poster-img"
        src={imgUrl}
        alt=""
        loading="lazy"
        draggable="false"
        style={{
          filter: `saturate(0.95) contrast(1.05) hue-rotate(${(tintHue % 30) - 15}deg)`,
        }}
      />
      <div className="poster-floor" />
      <div
        className="poster-title"
        style={{
          ...pos,
          fontFamily,
          fontWeight,
          letterSpacing,
          fontStyle,
        }}
      >
        {displayTitle.split(" ").map((w, i) => (
          <div key={i} className="poster-title-word">
            {w}
          </div>
        ))}
      </div>
      <div className="poster-brand">L</div>
      <div className="poster-tag">{data.tag}</div>
    </div>
  );
});

interface PosterRowProps {
  seed: string;
  speed: number;
  direction: number;
  scale: number;
  count: number;
}

const PosterRow = React.memo(function PosterRow({
  seed,
  speed,
  direction,
  scale,
  count,
}: PosterRowProps) {
  const items = React.useMemo(() => {
    const out: (PosterData & { _i: number })[] = [];
    const base = POSTER_TITLES.length;
    for (let i = 0; i < count; i++) {
      const idx = hash(seed + i) % base;
      const item = POSTER_TITLES[idx];
      if (item) {
        out.push({
          title: item.title,
          tag: item.tag,
          genre: item.genre,
          _i: i,
        });
      }
    }
    return out;
  }, [seed, count]);

  const duration = `${speed}s`;
  const animName = direction > 0 ? "rowScrollRight" : "rowScrollLeft";

  return (
    <div className="poster-row" style={{ "--row-scale": scale } as React.CSSProperties}>
      <div
        className="poster-track"
        style={{ animation: `${animName} ${duration} linear infinite` }}
      >
        {[0, 1].map((copy) => (
          <div className="poster-track-copy" key={copy}>
            {items.map((item, i) => (
              <Poster key={`${copy}-${i}`} data={item} idx={item._i + copy * 100} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

export const PosterGridBackground = React.memo(function PosterGridBackground() {
  const rows = React.useMemo(() => {
    const baseSpeeds = [120, 90, 140, 100, 130, 110, 95];
    const dirs = [1, -1, 1, -1, 1, -1, 1];
    const scales = [0.85, 1.0, 0.95, 1.05, 0.95, 1.0, 0.9];
    // Default visual density count: 6 rows
    return Array.from({ length: 6 }, (_, i) => ({
      seed: `row-${i}-v3`,
      speed: (baseSpeeds[i % baseSpeeds.length] ?? 100) / 0.2, // Default speed parameter from mock config
      direction: dirs[i % dirs.length] ?? 1,
      scale: scales[i % scales.length] ?? 1.0,
      count: 14,
    }));
  }, []);

  return (
    <div className="stage" id="stage">
      <div className="grid-3d" id="grid">
        {rows.map((r) => (
          <PosterRow key={r.seed} {...r} />
        ))}
      </div>
    </div>
  );
});
