import { useMemo } from "react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { splitRuntime, totalRuntimeMinutes } from "../lib/classify";
import type { LibraryCounts, LibraryFilter, LibraryItem, LibrarySort } from "../lib/types";

const FILTERS: { id: LibraryFilter; labelFn: () => string }[] = [
  { id: "all", labelFn: () => m.library_filter_all() },
  { id: "ready", labelFn: () => m.library_filter_ready() },
  { id: "in-progress", labelFn: () => m.library_filter_in_progress() },
  { id: "awaiting", labelFn: () => m.library_filter_awaiting() },
  { id: "upcoming", labelFn: () => m.library_filter_upcoming() },
];

const SORTS: { id: LibrarySort; labelFn: () => string }[] = [
  { id: "recent", labelFn: () => m.library_sort_recent() },
  { id: "alpha", labelFn: () => m.library_sort_alpha() },
  { id: "runtime", labelFn: () => m.library_sort_runtime() },
  { id: "status", labelFn: () => m.library_sort_status() },
];

interface LibraryHeaderProps {
  items: readonly LibraryItem[];
  counts: LibraryCounts;
  filter: LibraryFilter;
  sort: LibrarySort;
  onFilterChange: (next: LibraryFilter) => void;
  onSortChange: (next: LibrarySort) => void;
}

function filterCount(id: LibraryFilter, total: number, counts: LibraryCounts): number {
  const map: Record<LibraryFilter, number> = {
    all: total,
    ready: counts.ready,
    "in-progress": counts.inProgress,
    awaiting: counts.awaiting,
    upcoming: counts.upcoming,
  };
  return map[id];
}

export function LibraryHeader({
  items,
  counts,
  filter,
  sort,
  onFilterChange,
  onSortChange,
}: LibraryHeaderProps) {
  const totalMin = useMemo(() => totalRuntimeMinutes(items), [items]);
  const { days, hours } = splitRuntime(totalMin);
  const totalRuntime =
    days > 0
      ? m.library_runtime_days_hours({ days: String(days), hours: String(hours) })
      : m.library_runtime_hours({ hours: String(hours) });

  return (
    <header className="pt-8 pb-7">
      <div className="grid items-end gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
            {m.library_eyebrow()}
          </div>
          <h1 className="m-0 flex items-baseline gap-4 text-[clamp(44px,6vw,72px)] font-bold leading-[0.96] tracking-[-0.035em] text-foreground">
            {m.library_title()}
            <span className="font-mono text-[0.36em] font-medium tracking-[-0.02em] text-muted-foreground/70 tabular-nums">
              {String(items.length).padStart(2, "0")}
            </span>
          </h1>
        </div>
        <dl className="flex flex-col gap-1.5 text-end font-mono text-xs tracking-[0.04em] text-muted-foreground">
          <dt className="sr-only">{m.library_total_runtime({ value: totalRuntime })}</dt>
          <dd>{m.library_total_runtime({ value: totalRuntime })}</dd>
          <dd className="flex items-center justify-end gap-3">
            <span className="inline-flex items-center gap-1.5 text-success">
              <Pip className="bg-success" />
              {m.library_count_ready({ n: String(counts.ready) })}
            </span>
            <span className="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 text-primary">
              <Pip className="bg-primary" />
              {m.library_count_awaiting({ n: String(counts.awaiting) })}
            </span>
            <span className="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Pip className="bg-muted-foreground" />
              {m.library_count_upcoming({ n: String(counts.upcoming) })}
            </span>
          </dd>
        </dl>
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const count = filterCount(f.id, items.length, counts);
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange(f.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{f.labelFn()}</span>
                <span
                  className={cn(
                    "font-mono text-[11px] tabular-nums",
                    active ? "opacity-55" : "opacity-60",
                  )}
                >
                  {String(count).padStart(2, "0")}
                </span>
              </button>
            );
          })}
        </div>
        <label className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground">
          <span>{m.library_sort_label()}</span>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as LibrarySort)}
            className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1.5 font-sans text-xs text-foreground"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.labelFn()}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

function Pip({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
    />
  );
}
