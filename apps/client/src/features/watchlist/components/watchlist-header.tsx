import { useMemo } from "react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { formatRuntimeBudget, totalRuntimeMinutes } from "../lib/runtime";
import type { WatchlistCounts, WatchlistFilter, WatchlistItem, WatchlistSort } from "../lib/types";

interface WatchlistHeaderProps {
  items: readonly WatchlistItem[];
  counts: WatchlistCounts;
  filter: WatchlistFilter;
  onFilterChange: (next: WatchlistFilter) => void;
  sort: WatchlistSort;
  onSortChange: (next: WatchlistSort) => void;
}

type FilterPill = { id: WatchlistFilter; label: string; n: number };

export function WatchlistHeader({
  items,
  counts,
  filter,
  onFilterChange,
  sort,
  onSortChange,
}: WatchlistHeaderProps) {
  const totalMin = useMemo(() => totalRuntimeMinutes(items), [items]);
  const filters: FilterPill[] = [
    { id: "all", label: m.watchlist_filter_all(), n: items.length },
    { id: "available", label: m.watchlist_filter_ready(), n: counts.available },
    { id: "in-progress", label: m.watchlist_filter_in_progress(), n: counts.inProgress },
    {
      id: "requested",
      label: m.watchlist_filter_awaiting(),
      n: counts.requested + counts.unavailable,
    },
    { id: "upcoming", label: m.watchlist_filter_upcoming(), n: counts.upcoming },
  ];

  return (
    <header className="pt-8 pb-7">
      <div className="grid grid-cols-1 items-end gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
        <div>
          <div className="mb-3 font-mono text-[11px] tracking-[0.18em] text-primary uppercase">
            {m.watchlist_eyebrow()}
          </div>
          <h1 className="text-[clamp(2.75rem,6vw,4.5rem)] leading-[0.96] font-semibold tracking-[-0.035em] text-foreground">
            {m.watchlist_title()}
            <span className="ms-4 align-[0.6em] font-mono text-[0.36em] font-medium tracking-tight text-muted-foreground/70">
              {String(items.length).padStart(2, "0")}
            </span>
          </h1>
        </div>
        <div className="flex flex-col gap-1.5 font-mono text-xs tracking-[0.04em] text-muted-foreground sm:items-end sm:text-end">
          <div>{formatRuntimeBudget(totalMin)}</div>
          <div className="flex flex-wrap gap-x-1.5 sm:justify-end">
            <span className="text-success">
              ● {m.watchlist_status_summary_ready({ n: String(counts.available) })}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-500">
              ●{" "}
              {m.watchlist_status_summary_awaiting({
                n: String(counts.requested + counts.unavailable),
              })}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-foreground/85">
              ● {m.watchlist_status_summary_upcoming({ n: String(counts.upcoming) })}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((pill) => (
            <FilterPillButton
              key={pill.id}
              pill={pill}
              active={filter === pill.id}
              onSelect={onFilterChange}
            />
          ))}
        </div>
        <label className="inline-flex items-center gap-2 font-mono text-xs tracking-[0.04em] text-muted-foreground uppercase">
          <span>{m.watchlist_sort_label()}</span>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as WatchlistSort)}
            className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="recent">{m.watchlist_sort_recent()}</option>
            <option value="alpha">{m.watchlist_sort_alpha()}</option>
            <option value="runtime">{m.watchlist_sort_runtime()}</option>
            <option value="status">{m.watchlist_sort_status()}</option>
          </select>
        </label>
      </div>
    </header>
  );
}

function FilterPillButton({
  pill,
  active,
  onSelect,
}: {
  pill: FilterPill;
  active: boolean;
  onSelect: (next: WatchlistFilter) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(pill.id)}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-transparent text-muted-foreground hover:bg-card hover:text-foreground",
      )}
    >
      <span>{pill.label}</span>
      <span
        className={cn("font-mono text-[11px] tabular-nums", active ? "opacity-60" : "opacity-70")}
      >
        {String(pill.n).padStart(2, "0")}
      </span>
    </button>
  );
}
