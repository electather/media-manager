import { XIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import type { PerfFilters } from "../shared/types";

interface Props {
  filters: PerfFilters;
  onChange: (next: PerfFilters) => void;
}

const KIND_OPTIONS: ReadonlyArray<{ id: PerfFilters["kind"]; label: string }> = [
  { id: "all", label: "All" },
  { id: "http", label: "HTTP" },
  { id: "plugin", label: "Plugin" },
];

const SORT_OPTIONS: ReadonlyArray<{ id: PerfFilters["sort"]; label: string }> = [
  { id: "p95", label: "Sort: p95 (slowest)" },
  { id: "p99", label: "Sort: p99" },
  { id: "max", label: "Sort: max" },
  { id: "count", label: "Sort: call count" },
  { id: "lastAt", label: "Sort: last seen" },
];

const RANGE_OPTIONS: ReadonlyArray<{ id: PerfFilters["range"]; label: string }> = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

export const PERF_DEFAULT_FILTERS: PerfFilters = {
  kind: "all",
  sort: "p95",
  range: "24h",
  requestId: "",
  search: "",
};

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

export function PerfFilterBar({ filters, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonGroup
        value={filters.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => onChange({ ...filters, kind })}
      />
      <ButtonGroup
        value={filters.range}
        options={RANGE_OPTIONS}
        onChange={(range) => onChange({ ...filters, range })}
      />

      <select
        value={filters.sort}
        onChange={(e) => onChange({ ...filters, sort: e.target.value as PerfFilters["sort"] })}
        className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground/85 outline-none focus:border-input"
      >
        {SORT_OPTIONS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <Input
        value={filters.requestId}
        onChange={(e) => onChange({ ...filters, requestId: e.target.value })}
        placeholder="Request ID exact match…"
        className={cn(
          "h-8 w-56 font-mono text-xs",
          filters.requestId ? "border-primary/55" : undefined,
        )}
      />

      <Input
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        placeholder="Search route or method…"
        className="h-8 flex-1 min-w-44 text-xs"
      />

      {isDirty(filters) ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => onChange(PERF_DEFAULT_FILTERS)}
        >
          <XIcon className="size-3.5" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

interface ButtonGroupProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (next: T) => void;
}

function ButtonGroup<T extends string>({ value, options, onChange }: ButtonGroupProps<T>) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {options.map((opt, idx) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "px-3 py-1 text-xs font-medium",
            idx > 0 && "border-l border-border",
            value === opt.id
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
