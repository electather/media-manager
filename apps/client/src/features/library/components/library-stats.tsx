import { statLabel } from "../lib/labels";
import type { LibraryStats } from "../lib/types";

const STAT_ORDER: (keyof LibraryStats)[] = [
  "total",
  "movies",
  "shows",
  "watched",
  "fourK",
  "servers",
  "genres",
];

/**
 * The stats spine — a hairline-separated row of roll-up figures derived from
 * the current (filtered) catalog. The 1px gap over a `bg-border` surface draws
 * the dividers; each cell sits on `bg-card`.
 */
export function LibraryStats({ stats }: { stats: LibraryStats }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-4 xl:grid-cols-7">
      {STAT_ORDER.map((key) => (
        <div key={key} className="flex flex-col gap-1 bg-card px-4 py-3.5">
          <dt className="font-mono text-[0.625rem] uppercase tracking-wider text-muted-foreground/80">
            {statLabel(key)}
          </dt>
          <dd className="font-mono text-2xl font-semibold tabular-nums text-foreground">
            {stats[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
