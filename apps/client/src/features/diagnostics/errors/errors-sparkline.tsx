import { useState } from "react";

interface Props {
  hourly: Array<{ error: number; warning: number; info: number }>;
  width?: number;
  height?: number;
}

/** 24-hour stacked sparkline. Each bar is a single hour. Stacks info at the
 *  bottom, warning in the middle, error on top — so a glance answers "is
 *  something on fire". Hover reveals the exact bucket counts. */
export function ErrorsSparkline({ hourly, width = 320, height = 56 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = hourly.map((h) => h.error + h.warning + h.info);
  const max = Math.max(1, ...totals);
  const pad = 2;
  const cellW = (width - 2 * pad) / Math.max(1, hourly.length);
  const barW = Math.max(2, cellW - 2);
  const scale = (height - pad - 6) / max;
  const baseY = height - 4;

  return (
    <div className="relative inline-block" style={{ width, height: height + 14 }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Hourly error volume over the last 24 hours"
        className="block"
      >
        <line
          x1={pad}
          y1={baseY}
          x2={width - pad}
          y2={baseY}
          stroke="var(--color-border)"
          strokeWidth={1}
        />
        {hourly.map((bucket, i) => {
          const x = pad + i * cellW + (cellW - barW) / 2;
          const eH = bucket.error * scale;
          const wH = bucket.warning * scale;
          const iH = bucket.info * scale;
          const total = bucket.error + bucket.warning + bucket.info;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad + i * cellW} y={0} width={cellW} height={height} fill="transparent" />
              {iH > 0 ? (
                <rect x={x} y={baseY - iH} width={barW} height={iH} className="fill-chart-2/80" />
              ) : null}
              {wH > 0 ? (
                <rect
                  x={x}
                  y={baseY - iH - wH}
                  width={barW}
                  height={wH}
                  className="fill-primary/80"
                />
              ) : null}
              {eH > 0 ? (
                <rect
                  x={x}
                  y={baseY - iH - wH - eH}
                  width={barW}
                  height={eH}
                  className="fill-destructive"
                />
              ) : null}
              {total === 0 ? (
                <rect
                  x={x}
                  y={baseY - 1}
                  width={barW}
                  height={1}
                  className="fill-border"
                  opacity={hover === i ? 0.9 : 0.4}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between px-0.5 pt-[2px] font-mono text-[9px] text-muted-foreground/80">
        <span>−24h</span>
        <span>−12h</span>
        <span>now</span>
      </div>
      {hover !== null
        ? (() => {
            const bucket = hourly[hover];
            if (!bucket) return null;
            const x = pad + hover * cellW + cellW / 2;
            return (
              <div
                className="pointer-events-none absolute z-10 rounded-md border border-input bg-popover px-2 py-1 font-mono text-[11px] text-foreground/85 shadow-md"
                style={{ left: Math.max(0, Math.min(width - 130, x - 65)), top: -6 }}
              >
                <div className="text-[10px] text-muted-foreground/80">
                  −{24 - hover}h to −{23 - hover}h
                </div>
                <div className="mt-[2px] flex gap-2">
                  {bucket.error > 0 ? (
                    <span className="text-destructive">{bucket.error} err</span>
                  ) : null}
                  {bucket.warning > 0 ? (
                    <span className="text-primary">{bucket.warning} warn</span>
                  ) : null}
                  {bucket.info > 0 ? (
                    <span className="text-muted-foreground">{bucket.info} info</span>
                  ) : null}
                  {bucket.error + bucket.warning + bucket.info === 0 ? (
                    <span className="text-muted-foreground/80">—</span>
                  ) : null}
                </div>
              </div>
            );
          })()
        : null}
    </div>
  );
}
