import { XIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { cn } from "@/shared/lib/utils";
import { PERF_DEFAULT_FILTERS } from "../shared/types";
import type { PerfFilters } from "../shared/types";

interface Props {
  filters: PerfFilters;
  onChange: (next: PerfFilters) => void;
  /** True while a filter-change transition is in flight; dims the bar so a
   *  slow refetch reads as busy rather than idle (#833). */
  isPending?: boolean;
}

const KIND_OPTIONS: ReadonlyArray<{ id: PerfFilters["kind"]; label: () => string }> = [
  { id: "all", label: () => m.diagnostics_perf_kind_all() },
  { id: "http", label: () => m.diagnostics_perf_kind_http() },
  { id: "plugin", label: () => m.diagnostics_perf_kind_plugin() },
];

const SORT_OPTIONS: ReadonlyArray<{ id: PerfFilters["sort"]; label: () => string }> = [
  { id: "p95", label: () => m.diagnostics_perf_sort_p95() },
  { id: "p99", label: () => m.diagnostics_perf_sort_p99() },
  { id: "max", label: () => m.diagnostics_perf_sort_max() },
  { id: "count", label: () => m.diagnostics_perf_sort_count() },
  { id: "lastAt", label: () => m.diagnostics_perf_sort_lastAt() },
];

const RANGE_OPTIONS: ReadonlyArray<{ id: PerfFilters["range"]; label: () => string }> = [
  { id: "24h", label: () => m.diagnostics_filter_range_24h() },
  { id: "7d", label: () => m.diagnostics_filter_range_7d() },
  { id: "30d", label: () => m.diagnostics_filter_range_30d() },
];

// Short-circuit dirty check across each independent filter slot.
// fallow-ignore-next-line complexity
function isDirty(filters: PerfFilters): boolean {
  return (
    filters.kind !== "all" ||
    filters.sort !== "p95" ||
    filters.range !== "24h" ||
    filters.requestId.trim().length > 0 ||
    filters.search.trim().length > 0
  );
}

export function PerfFilterBar({ filters, onChange, isPending = false }: Props) {
  return (
    <div
      aria-busy={isPending}
      className={cn("flex flex-col gap-3 transition-opacity", isPending && "opacity-60")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedToggle
          value={filters.kind}
          options={KIND_OPTIONS}
          onChange={(kind) => onChange({ ...filters, kind })}
        />
        <SegmentedToggle
          value={filters.range}
          options={RANGE_OPTIONS}
          onChange={(range) => onChange({ ...filters, range })}
        />

        <Select
          value={filters.sort}
          onValueChange={(v) => onChange({ ...filters, sort: v as PerfFilters["sort"] })}
        >
          <SelectTrigger size="sm" className="!h-6 gap-1 py-0 pe-1.5 text-xs">
            <SelectValue>{(v) => SORT_OPTIONS.find((s) => s.id === v)?.label() ?? ""}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isDirty(filters) ? (
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto text-xs"
            onClick={() => onChange(PERF_DEFAULT_FILTERS)}
          >
            <XIcon className="size-3.5" />
            {m.diagnostics_filter_clear()}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filters.requestId}
          onChange={(e) => onChange({ ...filters, requestId: e.target.value })}
          placeholder={m.diagnostics_filter_request_id_placeholder()}
          className={cn(
            "h-8 w-full font-mono text-xs sm:w-56",
            filters.requestId ? "border-primary/55" : undefined,
          )}
        />

        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder={m.diagnostics_filter_search_perf_placeholder()}
          className="h-8 w-full text-xs sm:flex-1 sm:min-w-44 sm:w-auto"
        />
      </div>
    </div>
  );
}

interface SegmentedToggleProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ id: T; label: () => string }>;
  onChange: (next: T) => void;
}

function SegmentedToggle<T extends string>({ value, options, onChange }: SegmentedToggleProps<T>) {
  return (
    <ToggleGroup<T>
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked) onChange(picked);
      }}
      className="gap-0 overflow-hidden rounded-md border border-border"
    >
      {options.map((opt) => (
        <ToggleGroupItem<T> key={opt.id} value={opt.id} variant="segmented">
          {opt.label()}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
