import { useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchPerfSummary } from "../shared/fetchers";
import { MiniLineSpark } from "./mini-line-spark";

/** Four stat cards: requests/min, p50, p95, p99. Each pulls from
 *  `/admin/diagnostics/perf/summary` which returns 24 hourly buckets the
 *  cards then plot as sparklines. */
export function PerfStatsCards() {
  const summary = useQuery({
    queryKey: diagnosticsKeys.perf.summary(),
    queryFn: fetchPerfSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (summary.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-3 p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-8 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  const data = summary.data;
  if (!data) return null;

  const counts = data.hourlySeries.map((s) => s.count);
  const p50s = data.hourlySeries.map((s) => s.p50);
  const p95s = data.hourlySeries.map((s) => s.p95);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Requests / min"
        value={String(data.requestsPerMinute)}
        unit="rpm"
        spark={counts}
        accent="var(--color-primary)"
        hint="last hour"
      />
      <StatCard
        label="Latency · p50"
        value={String(data.p50)}
        unit="ms"
        spark={p50s}
        accent="var(--color-chart-2)"
        hint="24h"
      />
      <StatCard
        label="Latency · p95"
        value={String(data.p95)}
        unit="ms"
        spark={p95s}
        accent="var(--color-primary)"
        hint="24h"
      />
      <StatCard
        label="Latency · p99"
        value={String(data.p99)}
        unit="ms"
        spark={p95s}
        accent="var(--color-destructive)"
        hint="24h"
      />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  unit: string;
  spark: number[];
  accent: string;
  hint?: string;
}

function StatCard({ label, value, unit, spark, accent, hint }: StatCardProps) {
  return (
    <Card className="flex min-h-24 flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
          {label}
        </span>
        {hint ? <span className="text-[10px] text-muted-foreground/80">{hint}</span> : null}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold leading-none">{value}</span>
        <span className="font-mono text-xs text-muted-foreground/80">{unit}</span>
      </div>
      <div className="mt-auto">
        <MiniLineSpark data={spark} accent={accent} />
      </div>
    </Card>
  );
}
