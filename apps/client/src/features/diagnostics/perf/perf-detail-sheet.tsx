import { Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { m } from "@/paraglide/messages";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { Skeleton } from "@/shared/ui/skeleton";
import { CopyButton } from "@/shared/components/copy-button";
import { Separator } from "@/shared/ui/separator";
import { absoluteDateTime, formatDuration } from "@/shared/lib/time-format";
import { cn } from "@/shared/lib/utils";
import { DiagnosticsErrorBoundary } from "../shared/error-boundary";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchPerfDetail } from "../shared/fetchers";
import { ThreadChip } from "../thread-chip";
import { PERF_LABELS } from "../shared/types";
import type { PerfAggregateGroup } from "../shared/types";

interface Props {
  group: PerfAggregateGroup | null;
  detailId: string | null;
  onClose: () => void;
  onJumpThread: (requestId: string) => void;
}

/** Right-anchored drill view for a perf group. The "single record" path
 *  loads a specific perf row by id (e.g. when reached via deep link); the
 *  "group summary" path uses the parent aggregate row directly so we render
 *  immediately without re-querying. */
export function PerfDetailSheet({ group, detailId, onClose, onJumpThread }: Props) {
  const open = Boolean(group ?? detailId);
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent side="right" className="w-full max-w-2xl gap-0 sm:max-w-2xl">
        {group ? (
          <>
            <PerfGroupHeader group={group} />
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <GroupBody group={group} />
            </div>
          </>
        ) : detailId ? (
          <DiagnosticsErrorBoundary
            title={m.diagnostics_perf_load_failed_title()}
            body={m.diagnostics_perf_load_failed_body()}
            queryKey={diagnosticsKeys.perf.detail(detailId)}
          >
            <Suspense fallback={<PerfDetailSkeleton />}>
              <PerfDetailContent id={detailId} onJumpThread={onJumpThread} />
            </Suspense>
          </DiagnosticsErrorBoundary>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PerfGroupHeader({ group }: { group: PerfAggregateGroup }) {
  return (
    <SheetHeader className="border-b border-border">
      <SheetTitle className="font-mono text-sm">
        {group.route ?? group.pluginId ?? m.diagnostics_errors_table_unknown()}
      </SheetTitle>
      <p className="text-xs text-muted-foreground">
        {m.diagnostics_perf_detail_calls_last_seen({
          count: group.count.toLocaleString(),
          when: absoluteDateTime(group.lastAt),
        })}
      </p>
    </SheetHeader>
  );
}

function PerfDetailSkeleton() {
  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle className="font-mono text-sm">
          {m.diagnostics_perf_detail_title_fallback()}
        </SheetTitle>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <Skeleton className="h-32 w-full" />
      </div>
    </>
  );
}

/** Loads a single perf record by id using Suspense. Must be rendered inside a
 *  {@link DiagnosticsErrorBoundary} so a fetch error surfaces as a retryable
 *  fallback instead of a blank sheet. */
function PerfDetailContent({
  id,
  onJumpThread,
}: {
  id: string;
  onJumpThread: (requestId: string) => void;
}) {
  const { data } = useSuspenseQuery({
    queryKey: diagnosticsKeys.perf.detail(id),
    queryFn: () => fetchPerfDetail(id),
  });
  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle className="font-mono text-sm">
          {data.record.route ?? m.diagnostics_perf_detail_title_fallback()}
        </SheetTitle>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <SingleBody
          record={data.record}
          correlated={data.correlatedErrors}
          onJumpThread={onJumpThread}
        />
      </div>
    </>
  );
}

function GroupBody({ group }: { group: PerfAggregateGroup }) {
  const aboutCopy = group.route
    ? m.diagnostics_perf_detail_about_route({
        count: group.count.toLocaleString(),
        kind: group.kind,
      })
    : m.diagnostics_perf_detail_about_plugin({
        count: group.count.toLocaleString(),
        kind: group.kind,
      });
  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-3">
        <h3 className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
          {m.diagnostics_perf_detail_distribution()}
        </h3>
        <div className="rounded-md border border-border bg-background p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat labelKey="p50" value={formatDuration(group.p50)} />
            <Stat labelKey="p95" value={formatDuration(group.p95)} highlight="primary" />
            <Stat labelKey="p99" value={formatDuration(group.p99)} highlight="destructive" />
            <Stat labelKey="max" value={formatDuration(group.max)} />
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-1">
        <h3 className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
          {m.diagnostics_perf_detail_about_row()}
        </h3>
        <p className="text-xs text-muted-foreground">{aboutCopy}</p>
      </section>
    </div>
  );
}

interface SingleBodyProps {
  record: {
    id: string;
    requestId: string;
    durationMs: number;
    route: string | null;
    method: string | null;
    status: number | null;
    pluginId: string | null;
    createdAt: number;
  };
  correlated: Array<{
    id: string;
    severity: string;
    code: string | null;
    devMessage: string;
    createdAt: number;
  }>;
  onJumpThread: (requestId: string) => void;
}

// UI conditional rendering of optional record fields plus an empty-state
// branch is intrinsic.
// fallow-ignore-next-line complexity
function SingleBody({ record, correlated, onJumpThread }: SingleBodyProps) {
  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <h3 className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
          {m.diagnostics_perf_detail_single_call()}
        </h3>
        <p className="text-foreground/90">
          {record.method ? `${record.method} ` : ""}
          {record.route ?? record.pluginId ?? m.diagnostics_errors_table_unknown()} —{" "}
          {formatDuration(record.durationMs)}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ThreadChip requestId={record.requestId} onJump={onJumpThread} />
          <CopyButton value={record.requestId} />
          {record.status !== null ? (
            <span>{m.diagnostics_detail_http_status({ status: record.status })}</span>
          ) : null}
          <span className="font-mono">{absoluteDateTime(record.createdAt)}</span>
        </div>
      </section>

      {correlated.length > 0 ? (
        <section className="space-y-2">
          <h3 className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
            {m.diagnostics_perf_detail_correlated_errors()}
          </h3>
          <ul className="space-y-2">
            {correlated.map((err) => (
              <li
                key={err.id}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs"
              >
                <div className="font-mono text-xs text-destructive">
                  {err.code ?? m.diagnostics_errors_no_code()}
                </div>
                <div className="mt-0.5 text-foreground/85">{err.devMessage}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  labelKey,
  value,
  highlight,
}: {
  labelKey: "p50" | "p95" | "p99" | "max";
  value: string;
  highlight?: "primary" | "destructive";
}) {
  const colour =
    highlight === "destructive"
      ? "text-destructive"
      : highlight === "primary"
        ? "text-primary"
        : "text-foreground";
  return (
    <div>
      <div className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
        {PERF_LABELS[labelKey]()}
      </div>
      <div className={cn("mt-1 font-mono text-base font-medium", colour)}>{value}</div>
    </div>
  );
}
