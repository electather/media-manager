import { useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchErrorSummary } from "../shared/fetchers";
import { ErrorsSparkline } from "./errors-sparkline";

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

  const totals = data.hourlyBuckets.reduce(
    (acc, b) => ({
      error: acc.error + b.error,
      warning: acc.warning + b.warning,
      info: acc.info + b.info,
    }),
    { error: 0, warning: 0, info: 0 },
  );
  const total = totals.error + totals.warning + totals.info;

  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
          Errors · last 24h
        </div>
        <div
          className={`mt-1 text-3xl font-semibold leading-none ${totals.error > 0 ? "text-destructive" : "text-foreground"}`}
        >
          {total}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <SeverityChip color="bg-destructive" count={totals.error} label="error" />
          <SeverityChip color="bg-primary" count={totals.warning} label="warning" />
          <SeverityChip color="bg-chart-2" count={totals.info} label="info" />
          {data.lastHour > 0 ? (
            <span className="ml-auto rounded-md border border-destructive/40 bg-destructive/15 px-2 py-[2px] font-mono text-xs text-destructive">
              {data.lastHour} in last hour
            </span>
          ) : null}
        </div>
      </div>
      <ErrorsSparkline hourly={data.hourlyBuckets} width={360} height={56} />
    </Card>
  );
}

function SeverityChip({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${color}`} aria-hidden />
      {count} {label}
    </span>
  );
}
