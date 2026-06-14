import { useQuery } from "@tanstack/react-query";
import { m } from "@/paraglide/messages";
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
    // Shorter than the 60s default: this is a live monitoring view, so it stays
    // tighter than the 60s poll to avoid serving a full poll-interval of stale
    // stats when the admin reopens the tab.
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
        label={m.diagnostics_perf_stat_rpm()}
        value={String(data.requestsPerMinute)}
        unit={m.diagnostics_perf_unit_rpm()}
        spark={counts}
        accent="var(--color-primary)"
        hint={m.diagnostics_perf_hint_last_hour()}
      />
      <StatCard
        label={m.diagnostics_perf_stat_p50()}
        value={String(data.p50)}
        unit={m.diagnostics_perf_unit_ms()}
        spark={p50s}
        accent="var(--color-chart-2)"
        hint={m.diagnostics_perf_hint_24h()}
      />
      <StatCard
        label={m.diagnostics_perf_stat_p95()}
        value={String(data.p95)}
        unit={m.diagnostics_perf_unit_ms()}
        spark={p95s}
        accent="var(--color-primary)"
        hint={m.diagnostics_perf_hint_24h()}
      />
      <StatCard
        label={m.diagnostics_perf_stat_p99()}
        value={String(data.p99)}
        unit={m.diagnostics_perf_unit_ms()}
        spark={p95s}
        accent="var(--color-destructive)"
        hint={m.diagnostics_perf_hint_24h()}
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
        <span className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
          {label}
        </span>
        {hint ? <span className="text-xs text-muted-foreground/80">{hint}</span> : null}
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
