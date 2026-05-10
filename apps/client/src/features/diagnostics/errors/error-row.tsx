import type { ErrorSource } from "@ent-mcp/shared/diagnostics";
import { ChevronRightIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { SEVERITY_BG, SEVERITY_TEXT, SeverityDot } from "@/shared/components/severity-dot";
import { ThreadChip } from "../thread-chip";
import { formatAbs, formatRel } from "../shared/format";
import type { ErrorListRow } from "../shared/types";

interface Props {
  row: ErrorListRow;
  isOpen: boolean;
  onOpen: (id: string) => void;
  onJumpThread: (requestId: string) => void;
}

const SOURCE_LABELS: Record<ErrorSource, () => string> = {
  frontend: () => m.diagnostics_source_frontend(),
  backend: () => m.diagnostics_source_backend(),
  plugin: () => m.diagnostics_source_plugin(),
  cron: () => m.diagnostics_source_cron(),
};

// UI conditional rendering across optional row fields (pluginId, httpStatus,
// requestId) is intrinsic.
// fallow-ignore-next-line complexity
export function ErrorRow({ row, isOpen, onOpen, onJumpThread }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(row.id);
        }
      }}
      className={cn(
        "relative grid cursor-pointer gap-2 border-t border-border px-4 py-3 ps-6 transition-colors",
        "sm:grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] sm:items-center sm:gap-4",
        isOpen ? "bg-muted/55" : "hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 start-0 w-[3px]", SEVERITY_BG[row.severity])}
      />

      <div className="min-w-0 sm:col-start-4 sm:row-start-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={cn("font-mono text-xs font-medium", SEVERITY_TEXT[row.severity])}>
            {row.code ?? m.diagnostics_errors_no_code()}
          </span>
          {row.httpStatus !== null ? (
            <span className="font-mono text-xs text-muted-foreground/80">{row.httpStatus}</span>
          ) : null}
        </div>
        <div className="mt-1 truncate text-xs text-foreground/85">{row.devMessage}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:contents">
        <div
          className="font-mono text-xs text-muted-foreground sm:col-start-1 sm:row-start-1 sm:min-w-16"
          title={formatAbs(row.createdAt)}
        >
          {formatRel(row.createdAt)}
        </div>

        <SeverityDot severity={row.severity} glow className="sm:col-start-2 sm:row-start-1" />

        <div className="flex shrink-0 items-center gap-1.5 sm:col-start-3 sm:row-start-1">
          <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
            {SOURCE_LABELS[row.source]()}
          </span>
          {row.pluginId ? (
            <span className="rounded-md border border-chart-2/30 bg-chart-2/10 px-2 py-0.5 font-mono text-xs text-chart-2">
              {row.pluginId}
            </span>
          ) : null}
        </div>

        <div className="ms-auto flex items-center gap-2 sm:col-start-5 sm:row-start-1 sm:ms-0">
          <ThreadChip requestId={row.requestId} onJump={onJumpThread} />
          <ChevronRightIcon className="size-3.5 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
