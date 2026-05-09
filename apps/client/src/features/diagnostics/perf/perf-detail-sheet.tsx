import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { Skeleton } from "@/shared/ui/skeleton";
import { CopyButton } from "@/shared/ui/copy-button";
import { Separator } from "@/shared/ui/separator";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchPerfDetail } from "../shared/fetchers";
import { formatAbs, formatMs } from "../shared/format";
import { ThreadChip } from "../thread-chip";
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
  const detail = useQuery({
    queryKey: detailId ? diagnosticsKeys.perf.detail(detailId) : ["disabled"],
    queryFn: () => fetchPerfDetail(detailId!),
    enabled: Boolean(detailId),
  });

  const open = Boolean(group ?? detailId);
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent side="right" className="w-full max-w-2xl gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="font-mono text-sm">
            {group
              ? (group.route ?? group.pluginId ?? "(unknown)")
              : (detail.data?.record.route ?? "Detail")}
          </SheetTitle>
          {group ? (
            <p className="text-xs text-muted-foreground">
              {group.count.toLocaleString()} calls · last seen {formatAbs(group.lastAt)}
            </p>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {group ? <GroupBody group={group} /> : null}
          {detailId ? (
            detail.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : detail.data ? (
              <SingleBody
                record={detail.data.record}
                correlated={detail.data.correlatedErrors}
                onJumpThread={onJumpThread}
              />
            ) : null
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function GroupBody({ group }: { group: PerfAggregateGroup }) {
  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-3">
        <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
          Distribution · last 24h
        </h3>
        <div className="rounded-md border border-border bg-background p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="p50" value={formatMs(group.p50)} />
            <Stat label="p95" value={formatMs(group.p95)} highlight="primary" />
            <Stat label="p99" value={formatMs(group.p99)} highlight="destructive" />
            <Stat label="max" value={formatMs(group.max)} />
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-1">
        <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
          About this row
        </h3>
        <p className="text-xs text-muted-foreground">
          Aggregates {group.count.toLocaleString()} {group.kind} calls grouped by{" "}
          {group.route ? "route" : "plugin"}. Use the Errors tab to see related failures, or the
          aggregate row's request-id chips (when the table is filtered to a single thread).
        </p>
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

function SingleBody({ record, correlated, onJumpThread }: SingleBodyProps) {
  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
          Single call
        </h3>
        <p className="text-foreground/90">
          {record.method ? `${record.method} ` : ""}
          {record.route ?? record.pluginId ?? "(unknown)"} — {formatMs(record.durationMs)}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ThreadChip requestId={record.requestId} onJump={onJumpThread} />
          <CopyButton value={record.requestId} />
          {record.status !== null ? <span>HTTP {record.status}</span> : null}
          <span className="font-mono">{formatAbs(record.createdAt)}</span>
        </div>
      </section>

      {correlated.length > 0 ? (
        <section className="space-y-2">
          <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
            Errors on the same request
          </h3>
          <ul className="space-y-2">
            {correlated.map((err) => (
              <li
                key={err.id}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs"
              >
                <div className="font-mono text-[11px] text-destructive">
                  {err.code ?? "(no code)"}
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
  label,
  value,
  highlight,
}: {
  label: string;
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
      <div className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
        {label}
      </div>
      <div className={`mt-1 font-mono text-base font-medium ${colour}`}>{value}</div>
    </div>
  );
}
