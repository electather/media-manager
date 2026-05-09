import type { ErrorSeverity, ErrorSource } from "@ent-mcp/shared/diagnostics";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ThreadChip } from "../thread-chip";
import { formatAbs, formatRel } from "../shared/format";
import type { ErrorListRow } from "../shared/types";

interface Props {
  row: ErrorListRow;
  isOpen: boolean;
  onOpen: (id: string) => void;
  onJumpThread: (requestId: string) => void;
}

const SEVERITY_DOT: Record<ErrorSeverity, string> = {
  error:
    "bg-destructive shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-destructive)_18%,transparent)]",
  warning: "bg-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]",
  info: "bg-chart-2 shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-chart-2)_18%,transparent)]",
};

const SEVERITY_RAIL: Record<ErrorSeverity, string> = {
  error: "bg-destructive",
  warning: "bg-primary",
  info: "bg-chart-2",
};

const SEVERITY_TEXT: Record<ErrorSeverity, string> = {
  error: "text-destructive",
  warning: "text-primary",
  info: "text-chart-2",
};

const SOURCE_LABELS: Record<ErrorSource, string> = {
  frontend: "Frontend",
  backend: "Backend",
  plugin: "Plugin",
  cron: "Cron",
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
        "relative grid cursor-pointer gap-2 border-t border-border px-4 py-3 pl-6 transition-colors",
        "sm:grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] sm:items-center sm:gap-4",
        isOpen ? "bg-muted/55" : "hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute left-0 top-0 bottom-0 w-[3px]", SEVERITY_RAIL[row.severity])}
      />

      <div className="min-w-0 sm:col-start-4 sm:row-start-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={cn("font-mono text-xs font-medium", SEVERITY_TEXT[row.severity])}>
            {row.code ?? "(no code)"}
          </span>
          {row.httpStatus !== null ? (
            <span className="font-mono text-[11px] text-muted-foreground/80">{row.httpStatus}</span>
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

        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full sm:col-start-2 sm:row-start-1",
            SEVERITY_DOT[row.severity],
          )}
        />

        <div className="flex shrink-0 items-center gap-1.5 sm:col-start-3 sm:row-start-1">
          <span className="rounded-md border border-border bg-muted/40 px-2 py-[2px] text-xs text-muted-foreground">
            {SOURCE_LABELS[row.source]}
          </span>
          {row.pluginId ? (
            <span className="rounded-md border border-chart-2/30 bg-chart-2/10 px-2 py-[2px] font-mono text-xs text-chart-2">
              {row.pluginId}
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:col-start-5 sm:row-start-1 sm:ml-0">
          <ThreadChip requestId={row.requestId} onJump={onJumpThread} />
          <ChevronRightIcon className="size-3.5 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
