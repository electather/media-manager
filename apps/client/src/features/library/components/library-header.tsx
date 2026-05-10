import { useMemo } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
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
    <header>
      <SectionHead size="page">
        <SectionHeadHeading>
          <SectionHeadEyebrow size="page">{m.library_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle as="h1" size="page">
            {m.library_title()}
            <SectionHeadCount size="page" value={items.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <div className="flex flex-col gap-1.5 text-end font-mono text-xs tracking-[0.04em] text-muted-foreground">
            <p>{m.library_total_runtime({ value: totalRuntime })}</p>
            <p className="flex items-center justify-end gap-3">
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
            </p>
          </div>
        </SectionHeadActions>
      </SectionHead>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4 pb-6">
        <RadioGroup
          value={filter}
          onValueChange={(value) => onFilterChange(value as LibraryFilter)}
          aria-label={m.library_filter_label()}
        >
          {FILTERS.map((f) => {
            const count = filterCount(f.id, items.length, counts);
            return (
              <RadioGroupItem
                key={f.id}
                value={f.id}
                className="group px-3.5 py-1.5 text-sm data-checked:border-foreground data-checked:bg-foreground data-checked:text-background"
              >
                <span>{f.labelFn()}</span>
                <span className="font-mono text-[11px] tabular-nums opacity-60 group-data-checked:opacity-55">
                  {String(count).padStart(2, "0")}
                </span>
              </RadioGroupItem>
            );
          })}
        </RadioGroup>
        <label className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground">
          <span>{m.library_sort_label()}</span>
          <Select value={sort} onValueChange={(value) => onSortChange(value as LibrarySort)}>
            <SelectTrigger size="sm" aria-label={m.library_sort_label()} className="font-sans">
              <SelectValue>
                {(value: LibrarySort) => SORTS.find((s) => s.id === value)?.labelFn()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.labelFn()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
