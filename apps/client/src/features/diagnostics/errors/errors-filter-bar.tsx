import type { ErrorSeverity, ErrorSource } from "@ent-mcp/shared/diagnostics";
import { ERROR_SEVERITIES, ERROR_SOURCES } from "@ent-mcp/shared/diagnostics";
import { XIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import type { ErrorsFilters } from "../shared/types";

interface Props {
  filters: ErrorsFilters;
  onChange: (next: ErrorsFilters) => void;
}

const SEVERITY_STYLES: Record<ErrorSeverity, { dot: string; active: string }> = {
  error: {
    dot: "bg-destructive",
    active: "border-destructive/40 bg-destructive/15 text-destructive",
  },
  warning: { dot: "bg-primary", active: "border-primary/40 bg-primary/15 text-primary" },
  info: { dot: "bg-chart-2", active: "border-chart-2/40 bg-chart-2/15 text-chart-2" },
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
  const toggleSeverity = (sev: ErrorSeverity) => {
    const next = filters.severity.includes(sev)
      ? filters.severity.filter((s) => s !== sev)
      : [...filters.severity, sev];
    onChange({ ...filters, severity: next });
  };
  const toggleSource = (src: ErrorSource) => {
    const next = filters.source.includes(src)
      ? filters.source.filter((s) => s !== src)
      : [...filters.source, src];
    onChange({ ...filters, source: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <FilterLabel>Severity</FilterLabel>
        <div className="flex flex-wrap gap-1.5">
          {ERROR_SEVERITIES.map((sev) => (
            <Chip
              key={sev}
              active={filters.severity.includes(sev)}
              onClick={() => toggleSeverity(sev)}
              activeClassName={SEVERITY_STYLES[sev].active}
            >
              <span className={`size-1.5 rounded-full ${SEVERITY_STYLES[sev].dot}`} aria-hidden />
              {sev[0]?.toUpperCase()}
              {sev.slice(1)}
            </Chip>
          ))}
        </div>

        <FilterLabel>Source</FilterLabel>
        <div className="flex flex-wrap gap-1.5">
          {ERROR_SOURCES.map((src) => (
            <Chip key={src} active={filters.source.includes(src)} onClick={() => toggleSource(src)}>
              {SOURCE_LABELS[src]}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border">
          {RANGES.map((r, idx) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onChange({ ...filters, range: r.id })}
              className={cn(
                "px-3 py-1 text-xs font-medium",
                idx > 0 && "border-l border-border",
                filters.range === r.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

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
          placeholder="Search code or message…"
          className="h-8 flex-1 min-w-44 text-xs"
        />

        {isDirty(filters) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="text-xs"
          >
            <XIcon className="size-3.5" />
            Clear
          </Button>
        ) : null}
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

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  activeClassName?: string;
}

function Chip({ active, onClick, children, activeClassName }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? (activeClassName ?? "border-input bg-muted text-foreground")
          : "border-border text-muted-foreground hover:bg-muted/60",
      )}
    >
      {children}
    </button>
  );
}

export const ERRORS_DEFAULT_FILTERS = DEFAULT_FILTERS;
