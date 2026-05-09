import type { ErrorSeverity, ErrorSource } from "@ent-mcp/shared/diagnostics";
import { ERROR_SEVERITIES, ERROR_SOURCES } from "@ent-mcp/shared/diagnostics";
import { XIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { cn } from "@/shared/lib/utils";
import type { ErrorsFilters } from "../shared/types";

interface Props {
  filters: ErrorsFilters;
  onChange: (next: ErrorsFilters) => void;
}

const SEVERITY_STYLES: Record<ErrorSeverity, { dot: string; pressed: string }> = {
  error: {
    dot: "bg-destructive",
    pressed:
      "data-pressed:border-destructive/40 data-pressed:bg-destructive/15 data-pressed:text-destructive",
  },
  warning: {
    dot: "bg-primary",
    pressed: "data-pressed:border-primary/40 data-pressed:bg-primary/15 data-pressed:text-primary",
  },
  info: {
    dot: "bg-chart-2",
    pressed: "data-pressed:border-chart-2/40 data-pressed:bg-chart-2/15 data-pressed:text-chart-2",
  },
};

const SOURCE_LABELS: Record<ErrorSource, string> = {
  frontend: "Frontend",
  backend: "Backend",
  plugin: "Plugin",
  cron: "Cron",
};

const RANGES: ReadonlyArray<{ id: ErrorsFilters["range"]; label: string }> = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

const DEFAULT_FILTERS: ErrorsFilters = {
  severity: ["error", "warning", "info"],
  source: ["frontend", "backend", "plugin", "cron"],
  pluginId: null,
  range: "24h",
  requestId: "",
  search: "",
};

// Short-circuit dirty check across each independent filter slot.
// fallow-ignore-next-line complexity
function isDirty(filters: ErrorsFilters): boolean {
  return (
    filters.severity.length < 3 ||
    filters.source.length < 4 ||
    filters.pluginId !== null ||
    filters.range !== "24h" ||
    filters.requestId.trim().length > 0 ||
    filters.search.trim().length > 0
  );
}

export function ErrorsFilterBar({ filters, onChange }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <FilterLabel>Severity</FilterLabel>
        <ToggleGroup<ErrorSeverity>
          multiple
          value={filters.severity}
          onValueChange={(next) => onChange({ ...filters, severity: next })}
        >
          {ERROR_SEVERITIES.map((sev) => (
            <ToggleGroupItem<ErrorSeverity>
              key={sev}
              value={sev}
              className={cn(
                "data-pressed:bg-transparent data-pressed:text-foreground",
                SEVERITY_STYLES[sev].pressed,
              )}
            >
              <span className={`size-1.5 rounded-full ${SEVERITY_STYLES[sev].dot}`} aria-hidden />
              {sev[0]?.toUpperCase()}
              {sev.slice(1)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <FilterLabel>Source</FilterLabel>
        <ToggleGroup<ErrorSource>
          multiple
          value={filters.source}
          onValueChange={(next) => onChange({ ...filters, source: next })}
        >
          {ERROR_SOURCES.map((src) => (
            <ToggleGroupItem<ErrorSource> key={src} value={src}>
              {SOURCE_LABELS[src]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {isDirty(filters) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="ml-auto text-xs"
          >
            <XIcon className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup<ErrorsFilters["range"]>
          value={[filters.range]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked) onChange({ ...filters, range: picked });
          }}
          className="gap-0 overflow-hidden rounded-md border border-border"
        >
          {RANGES.map((r) => (
            <ToggleGroupItem<ErrorsFilters["range"]> key={r.id} value={r.id} variant="segmented">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

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
          placeholder="Search code or message…"
          className="h-8 w-full text-xs sm:flex-1 sm:min-w-44 sm:w-auto"
        />
      </div>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
      {children}
    </span>
  );
}

export const ERRORS_DEFAULT_FILTERS = DEFAULT_FILTERS;
