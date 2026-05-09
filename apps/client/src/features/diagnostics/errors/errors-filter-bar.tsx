import type { ErrorSeverity, ErrorSource } from "@ent-mcp/shared/diagnostics";
import { ERROR_SEVERITIES, ERROR_SOURCES } from "@ent-mcp/shared/diagnostics";
import { XIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { SeverityDot } from "@/shared/components/severity-dot";
import { cn } from "@/shared/lib/utils";
import type { ErrorsFilters } from "../shared/types";

interface Props {
  filters: ErrorsFilters;
  onChange: (next: ErrorsFilters) => void;
}

const SEVERITY_PRESSED: Record<ErrorSeverity, string> = {
  error:
    "data-pressed:border-destructive/40 data-pressed:bg-destructive/15 data-pressed:text-destructive",
  warning: "data-pressed:border-primary/40 data-pressed:bg-primary/15 data-pressed:text-primary",
  info: "data-pressed:border-chart-2/40 data-pressed:bg-chart-2/15 data-pressed:text-chart-2",
};

const SEVERITY_LABELS: Record<ErrorSeverity, () => string> = {
  error: () => m.diagnostics_severity_error(),
  warning: () => m.diagnostics_severity_warning(),
  info: () => m.diagnostics_severity_info(),
};

const SOURCE_LABELS: Record<ErrorSource, () => string> = {
  frontend: () => m.diagnostics_source_frontend(),
  backend: () => m.diagnostics_source_backend(),
  plugin: () => m.diagnostics_source_plugin(),
  cron: () => m.diagnostics_source_cron(),
};

const RANGE_LABELS: Record<ErrorsFilters["range"], () => string> = {
  "24h": () => m.diagnostics_filter_range_24h(),
  "7d": () => m.diagnostics_filter_range_7d(),
  "30d": () => m.diagnostics_filter_range_30d(),
};

const RANGES: ReadonlyArray<ErrorsFilters["range"]> = ["24h", "7d", "30d"];

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
        <FilterLabel>{m.diagnostics_filter_label_severity()}</FilterLabel>
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
                SEVERITY_PRESSED[sev],
              )}
            >
              <SeverityDot severity={sev} size="sm" />
              {SEVERITY_LABELS[sev]()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <FilterLabel>{m.diagnostics_filter_label_source()}</FilterLabel>
        <ToggleGroup<ErrorSource>
          multiple
          value={filters.source}
          onValueChange={(next) => onChange({ ...filters, source: next })}
        >
          {ERROR_SOURCES.map((src) => (
            <ToggleGroupItem<ErrorSource> key={src} value={src}>
              {SOURCE_LABELS[src]()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {isDirty(filters) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="ms-auto text-xs"
          >
            <XIcon className="size-3.5" />
            {m.diagnostics_filter_clear()}
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
          {RANGES.map((id) => (
            <ToggleGroupItem<ErrorsFilters["range"]> key={id} value={id} variant="segmented">
              {RANGE_LABELS[id]()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

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
          placeholder={m.diagnostics_filter_search_errors_placeholder()}
          className="h-8 w-full text-xs sm:flex-1 sm:min-w-44 sm:w-auto"
        />
      </div>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
      {children}
    </span>
  );
}

export const ERRORS_DEFAULT_FILTERS = DEFAULT_FILTERS;
