import { ChevronRightIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { formatMs, formatRel } from "../shared/format";
import type { PerfAggregateGroup } from "../shared/types";

interface Props {
  group: PerfAggregateGroup;
  isOpen: boolean;
  onOpen: () => void;
}

const PERF_LABELS: Record<"p50" | "p95" | "p99" | "max", () => string> = {
  p50: () => m.diagnostics_perf_label_p50(),
  p95: () => m.diagnostics_perf_label_p95(),
  p99: () => m.diagnostics_perf_label_p99(),
  max: () => m.diagnostics_perf_label_max(),
};

/** Per-route or per-plugin aggregate row. The latency cells colour-code off
 *  the row's own distribution — p99 is "warn" tone, max is "danger" tone —
 *  so a glance at the right edge surfaces tail outliers without needing a
 *  separate column or threshold input. */
// Renders four latency cells whose colour-tone branches reflect the row's own
// distribution; per-cell helpers would not simplify.
// fallow-ignore-next-line complexity
export function PerfRow({ group, isOpen, onOpen }: Props) {
  const warn = group.p99;
  const danger = group.max;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-3 border-t border-border px-4 py-3 transition-colors sm:grid sm:items-center sm:gap-4",
        "sm:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(60px,auto))_14px]",
        isOpen ? "bg-muted/55" : "hover:bg-muted/40",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2 sm:block">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <KindBadge kind={group.kind} />
            <span className="font-mono text-sm font-medium text-foreground">
              {group.route ?? group.pluginId ?? m.diagnostics_errors_table_unknown()}
            </span>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground/80">
            {m.diagnostics_perf_calls_last_seen({
              count: group.count.toLocaleString(),
              when: formatRel(group.lastAt),
            })}
          </div>
        </div>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground sm:hidden" />
      </div>

      <div className="grid grid-cols-4 gap-2 sm:contents">
        <Latency labelKey="p50" ms={group.p50} warn={warn + 1} danger={danger + 1} />
        <Latency labelKey="p95" ms={group.p95} warn={warn} danger={danger} />
        <Latency labelKey="p99" ms={group.p99} warn={warn} danger={danger} />
        <Latency labelKey="max" ms={group.max} warn={warn + 1} danger={danger} />
      </div>

      <ChevronRightIcon className="hidden size-3.5 text-muted-foreground sm:block" />
    </div>
  );
}

function KindBadge({ kind }: { kind: PerfAggregateGroup["kind"] }) {
  const isPlugin = kind === "plugin";
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-px font-mono text-xs font-semibold uppercase tracking-wide",
        isPlugin
          ? "border-chart-2/30 bg-chart-2/10 text-chart-2"
          : "border-primary/35 bg-primary/15 text-primary",
      )}
    >
      {kind}
    </span>
  );
}

function Latency({
  labelKey,
  ms,
  warn,
  danger,
}: {
  labelKey: "p50" | "p95" | "p99" | "max";
  ms: number;
  warn: number;
  danger: number;
}) {
  let toneClass = "text-foreground/85";
  if (ms >= danger) toneClass = "text-destructive";
  else if (ms >= warn) toneClass = "text-primary";
  return (
    <div className="text-right">
      <div className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
        {PERF_LABELS[labelKey]()}
      </div>
      <div className={cn("font-mono text-xs font-medium", toneClass)}>{formatMs(ms)}</div>
    </div>
  );
}
