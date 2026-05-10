import { useQuery } from "@tanstack/react-query";
import { sumBy } from "es-toolkit";
import { m } from "@/paraglide/messages";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { SeverityDot, type Severity } from "@/shared/components/severity-dot";
import { cn } from "@/shared/lib/utils";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchErrorSummary } from "../shared/fetchers";
import { ErrorsSparkline } from "./errors-sparkline";

const SEVERITY_LABELS: Record<Severity, () => string> = {
  error: () => m.diagnostics_severity_label_error(),
  warning: () => m.diagnostics_severity_label_warning(),
  info: () => m.diagnostics_severity_label_info(),
};

/** Last-24-hour count headline + stacked hourly sparkline. Numbers come from
 *  `/admin/diagnostics/errors/summary` which the server pre-bins into 24
 *  buckets keyed by severity. */
// Renders pending/empty/data branches plus a per-severity chip set;
// combining would not simplify.
// fallow-ignore-next-line complexity
export function ErrorsHeader() {
  const summary = useQuery({
    queryKey: diagnosticsKeys.errors.summary(),
    queryFn: fetchErrorSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (summary.isPending) {
    return (
      <Card className="flex items-center gap-6 p-5">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-14 w-80" />
      </Card>
    );
  }

  const data = summary.data;
  if (!data) return null;

  const totals: Record<Severity, number> = {
    error: sumBy(data.hourlyBuckets, (b) => b.error),
    warning: sumBy(data.hourlyBuckets, (b) => b.warning),
    info: sumBy(data.hourlyBuckets, (b) => b.info),
  };
  const total = totals.error + totals.warning + totals.info;

  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
          {m.diagnostics_errors_summary_label()}
        </div>
        <div
          className={cn(
            "mt-1 text-3xl font-semibold leading-none",
            totals.error > 0 ? "text-destructive" : "text-foreground",
          )}
        >
          {total}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <SeverityChip severity="error" count={totals.error} />
          <SeverityChip severity="warning" count={totals.warning} />
          <SeverityChip severity="info" count={totals.info} />
          {data.lastHour > 0 ? (
            <span className="ms-auto rounded-md border border-destructive/40 bg-destructive/15 px-2 py-0.5 font-mono text-xs text-destructive">
              {m.diagnostics_errors_last_hour({ count: data.lastHour })}
            </span>
          ) : null}
        </div>
      </div>
      <div className="hidden sm:block">
        <ErrorsSparkline hourly={data.hourlyBuckets} width={360} height={56} />
      </div>
    </Card>
  );
}

function SeverityChip({ severity, count }: { severity: Severity; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SeverityDot severity={severity} />
      {m.diagnostics_errors_chip({ count, label: SEVERITY_LABELS[severity]() })}
    </span>
  );
}
