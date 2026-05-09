import { XIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
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
    <div className="flex flex-col gap-3">
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
          <SelectTrigger size="sm" className="!h-6 gap-1 py-0 pr-1.5 text-xs">
            <SelectValue>{(v) => SORT_OPTIONS.find((s) => s.id === v)?.label ?? ""}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isDirty(filters) ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-xs"
            onClick={() => onChange(PERF_DEFAULT_FILTERS)}
          >
            <XIcon className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filters.requestId}
          onChange={(e) => onChange({ ...filters, requestId: e.target.value })}
          placeholder="Request ID exact match…"
          className={cn(
            "h-8 w-full font-mono text-xs sm:w-56",
            filters.requestId ? "border-primary/55" : undefined,
          )}
        />

        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search route or method…"
          className="h-8 w-full text-xs sm:flex-1 sm:min-w-44 sm:w-auto"
        />
      </div>
    </div>
  );
}

interface SegmentedToggleProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
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
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
