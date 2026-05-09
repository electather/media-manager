import { useState } from "react";
import { maxBy } from "es-toolkit";
import { m } from "@/paraglide/messages";

interface Props {
  hourly: Array<{ error: number; warning: number; info: number }>;
  width?: number;
  height?: number;
}

interface Bucket {
  error: number;
  warning: number;
  info: number;
}

interface BarGeometry {
  pad: number;
  cellW: number;
  barW: number;
  scale: number;
  baseY: number;
  height: number;
}

/** 24-hour stacked sparkline. Each bar is a single hour. Stacks info at the
 *  bottom, warning in the middle, error on top — so a glance answers "is
 *  something on fire". Hover reveals the exact bucket counts. */
export function ErrorsSparkline({ hourly, width = 320, height = 56 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = hourly.map((h) => h.error + h.warning + h.info);
  const peak = Math.max(1, maxBy(totals, (n) => n) ?? 1);
  const pad = 2;
  const cellW = (width - 2 * pad) / Math.max(1, hourly.length);
  const barW = Math.max(2, cellW - 2);
  const scale = (height - pad - 6) / peak;
  const baseY = height - 4;
  const geom: BarGeometry = { pad, cellW, barW, scale, baseY, height };

  return (
    <div className="relative inline-block" style={{ width, height: height + 14 }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={m.diagnostics_sparkline_aria()}
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
        {hourly.map((bucket, i) => (
          <Bar
            key={i}
            bucket={bucket}
            index={i}
            geom={geom}
            isHovered={hover === i}
            onEnter={() => setHover(i)}
            onLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <div className="flex justify-between px-0.5 pt-0.5 font-mono text-xs text-muted-foreground/80">
        <span>{m.diagnostics_sparkline_minus_24h()}</span>
        <span>{m.diagnostics_sparkline_minus_12h()}</span>
        <span>{m.diagnostics_sparkline_now()}</span>
      </div>
      {hover !== null ? (
        <Tooltip bucket={hourly[hover]} hover={hover} geom={geom} width={width} />
      ) : null}
    </div>
  );
}

interface BarProps {
  bucket: Bucket;
  index: number;
  geom: BarGeometry;
  isHovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
}

// Stacked-bar SVG renderer; one branch per stack segment is intrinsic.
// fallow-ignore-next-line complexity
function Bar({ bucket, index, geom, isHovered, onEnter, onLeave }: BarProps) {
  const { pad, cellW, barW, scale, baseY, height } = geom;
  const x = pad + index * cellW + (cellW - barW) / 2;
  const eH = bucket.error * scale;
  const wH = bucket.warning * scale;
  const iH = bucket.info * scale;
  const total = bucket.error + bucket.warning + bucket.info;
  return (
    <g onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <rect x={pad + index * cellW} y={0} width={cellW} height={height} fill="transparent" />
      {iH > 0 ? (
        <rect x={x} y={baseY - iH} width={barW} height={iH} className="fill-chart-2/80" />
      ) : null}
      {wH > 0 ? (
        <rect x={x} y={baseY - iH - wH} width={barW} height={wH} className="fill-primary/80" />
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
          opacity={isHovered ? 0.9 : 0.4}
        />
      ) : null}
    </g>
  );
}

interface TooltipProps {
  bucket: Bucket | undefined;
  hover: number;
  geom: BarGeometry;
  width: number;
}

// Hover tooltip toggles per-severity rows; one branch per metric is intrinsic.
// fallow-ignore-next-line complexity
function Tooltip({ bucket, hover, geom, width }: TooltipProps) {
  if (!bucket) return null;
  const { pad, cellW } = geom;
  const x = pad + hover * cellW + cellW / 2;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-input bg-popover px-2 py-1 font-mono text-xs text-foreground/85 shadow-md"
      style={{ left: Math.max(0, Math.min(width - 130, x - 65)), top: -6 }}
    >
      <div className="text-xs text-muted-foreground/80">
        {m.diagnostics_sparkline_range_aria({ from: 24 - hover, to: 23 - hover })}
      </div>
      <div className="mt-0.5 flex gap-2">
        {bucket.error > 0 ? (
          <span className="text-destructive">
            {m.diagnostics_sparkline_err({ count: bucket.error })}
          </span>
        ) : null}
        {bucket.warning > 0 ? (
          <span className="text-primary">
            {m.diagnostics_sparkline_warn({ count: bucket.warning })}
          </span>
        ) : null}
        {bucket.info > 0 ? (
          <span className="text-muted-foreground">
            {m.diagnostics_sparkline_info({ count: bucket.info })}
          </span>
        ) : null}
        {bucket.error + bucket.warning + bucket.info === 0 ? (
          <span className="text-muted-foreground/80">—</span>
        ) : null}
      </div>
    </div>
  );
}
