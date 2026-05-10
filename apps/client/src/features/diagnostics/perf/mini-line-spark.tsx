interface Props {
  data: number[];
  width?: number;
  height?: number;
  /** CSS color expression. Defaults to the project's primary tone. */
  accent?: string;
}

/** Tiny SVG sparkline used inside the four stat cards. The fill area underneath
 *  the polyline is generated from the same point list with a closing baseline,
 *  so a flat series renders as a thin band rather than vanishing. */
export function MiniLineSpark({
  data,
  width = 140,
  height = 32,
  accent = "var(--color-primary)",
}: Props) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(1, max - min);
  const denom = Math.max(1, data.length - 1);
  const stepX = (width - 4) / denom;
  const points = data
    .map((v, i) => {
      const x = 2 + i * stepX;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `2,${height - 2} ${points} ${(width - 2).toFixed(1)},${height - 2}`;
  return (
    <svg width={width} height={height} role="img" aria-label="24-hour trend" className="block">
      <polygon points={area} fill={accent} fillOpacity={0.15} />
      <polyline
        points={points}
        fill="none"
        stroke={accent}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
