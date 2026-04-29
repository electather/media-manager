import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlertIcon, CircleAlertIcon, ExternalLinkIcon } from "lucide-react";
import { z } from "zod";

import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { CopyButton } from "@/shared/ui/copy-button";
import { api } from "@/shared/lib/api";
import { shortRequestId } from "@/shared/lib/errors/request-id";
import { cn } from "@/shared/lib/utils";

const severityValues = ["error", "warning"] as const;
const sourceValues = ["frontend", "backend", "plugin", "cron"] as const;
const rangeValues = ["24h", "7d", "30d", "all"] as const;

const searchSchema = z.object({
  severity: z.string().optional(),
  source: z.string().optional(),
  pluginId: z.string().optional(),
  requestId: z.string().optional(),
  search: z.string().optional(),
  range: z.enum(rangeValues).optional().default("24h"),
  selected: z.string().optional(),
});

type SearchParams = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_authenticated/_settings/admin/logs")({
  component: AdminLogsPage,
  validateSearch: (search) => searchSchema.parse(search),
});

interface ListRecord {
  id: string;
  requestId: string;
  severity: "error" | "warning";
  source: "frontend" | "backend" | "plugin" | "cron";
  code: string | null;
  devMessage: string;
  route: string | null;
  httpStatus: number | null;
  userId: string | null;
  pluginId: string | null;
  createdAt: number;
}

interface DetailRecord extends ListRecord {
  stack: string | null;
  context: string | null;
  connectionId: string | null;
}

interface Summary {
  lastHour: number;
  last24h: number;
  hourlyBuckets: number[];
}

// fallow-ignore-next-line complexity
function AdminLogsPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  const severity = useMemo(
    () => (search.severity ? search.severity.split(",") : ["error"]),
    [search.severity],
  );
  const source = useMemo(() => (search.source ? search.source.split(",") : []), [search.source]);

  const updateSearch = (patch: Partial<SearchParams>) => {
    void navigate({
      search: (prev) => ({ ...(prev as SearchParams), ...patch }),
      replace: true,
    });
  };

  const summary = useQuery({
    queryKey: ["admin", "logs", "summary"],
    queryFn: async (): Promise<Summary> => {
      const res = await api.admin.errors.summary.$get();
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as Summary;
    },
    refetchInterval: 60_000,
  });

  const sinceFor = (range: SearchParams["range"]): number | undefined => {
    if (range === "all") return undefined;
    const ms = range === "24h" ? 86_400_000 : range === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
    return Date.now() - ms;
  };

  const list = useQuery({
    queryKey: [
      "admin",
      "logs",
      "list",
      severity.join(","),
      source.join(","),
      search.pluginId ?? "",
      search.requestId ?? "",
      search.search ?? "",
      search.range,
    ],
    // fallow-ignore-next-line complexity
    queryFn: async (): Promise<{ records: ListRecord[]; total: number }> => {
      const query: Record<string, string> = {};
      query.severity = severity.join(",");
      if (source.length > 0) query.source = source.join(",");
      if (search.pluginId) query.pluginId = search.pluginId;
      if (search.requestId) query.requestId = search.requestId;
      if (search.search) query.search = search.search;
      const since = sinceFor(search.range);
      if (since) query.since = String(since);
      const res = await api.admin.errors.$get({ query });
      if (!res.ok) throw new Error("failed to load logs");
      return (await res.json()) as { records: ListRecord[]; total: number };
    },
  });

  const selectedId = search.selected ?? null;
  const detail = useQuery({
    enabled: !!selectedId,
    queryKey: ["admin", "logs", "detail", selectedId],
    queryFn: async (): Promise<DetailRecord> => {
      const res = await api.admin.errors[":id"].$get({
        param: { id: selectedId! },
      });
      if (!res.ok) throw new Error("failed to load detail");
      const body = (await res.json()) as { record: DetailRecord };
      return body.record;
    },
  });

  return (
    <div className="flex flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Logs</h1>
        <p className="max-w-[64ch] text-sm text-muted-foreground">
          Logs captured from the frontend, backend, and plugins.
        </p>
      </header>

      <SummaryWidget summary={summary.data} />

      <FilterBar
        severity={severity}
        source={source}
        range={search.range}
        searchValue={search.search ?? ""}
        requestIdValue={search.requestId ?? ""}
        onSeverity={(next) =>
          updateSearch({
            severity: next.length === 0 ? undefined : next.join(","),
          })
        }
        onSource={(next) =>
          updateSearch({
            source: next.length === 0 ? undefined : next.join(","),
          })
        }
        onRange={(next) => updateSearch({ range: next })}
        onSearch={(next) => updateSearch({ search: next || undefined })}
        onRequestId={(next) => updateSearch({ requestId: next || undefined })}
      />

      <ResultsTable
        loading={list.isLoading}
        records={list.data?.records ?? []}
        total={list.data?.total ?? 0}
        onSelect={(id) => updateSearch({ selected: id })}
      />

      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) updateSearch({ selected: undefined });
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Log detail</SheetTitle>
          </SheetHeader>
          <div className="px-4 flex-1">
            {detail.isLoading ? (
              <div className="mt-4 flex flex-col gap-3">
                <Skeleton className="h-6" />
                <Skeleton className="h-40" />
              </div>
            ) : detail.data ? (
              <DetailPanel
                record={detail.data}
                onFollowRequestId={(rid) => updateSearch({ requestId: rid, selected: undefined })}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Summary widget ───────────────────────────────────────────────────────────

function SummaryWidget({ summary }: { summary: Summary | undefined }) {
  if (!summary) {
    return <Skeleton className="h-20" />;
  }
  const max = Math.max(1, ...summary.hourlyBuckets);
  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
      <div>
        <p className="text-2xl font-semibold tabular-nums">{summary.last24h}</p>
        <p className="text-xs text-muted-foreground">errors in the last 24h</p>
      </div>
      <div className="flex h-10 items-end gap-0.5">
        {summary.hourlyBuckets.map((n, idx) => (
          <div
            key={idx}
            className="w-1.5 rounded-sm bg-destructive/60"
            style={{
              height: `${(n / max) * 100}%`,
              minHeight: n > 0 ? "2px" : "1px",
            }}
            title={`${n} errors`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  severity: string[];
  source: string[];
  range: SearchParams["range"];
  searchValue: string;
  requestIdValue: string;
  onSeverity: (next: string[]) => void;
  onSource: (next: string[]) => void;
  onRange: (next: SearchParams["range"]) => void;
  onSearch: (next: string) => void;
  onRequestId: (next: string) => void;
}

function FilterBar(props: FilterBarProps) {
  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-3">
      <FilterBlock label="Severity">
        <PillGroup>
          {severityValues.map((s) => (
            <Pill
              key={s}
              active={props.severity.includes(s)}
              onClick={() => {
                const next = toggleIn(props.severity, s);
                props.onSeverity(next.length === 0 ? ["error"] : next);
              }}
            >
              {s}
            </Pill>
          ))}
        </PillGroup>
      </FilterBlock>
      <FilterBlock label="Source">
        <PillGroup>
          {sourceValues.map((s) => (
            <Pill
              key={s}
              active={props.source.includes(s)}
              onClick={() => props.onSource(toggleIn(props.source, s))}
            >
              {s}
            </Pill>
          ))}
        </PillGroup>
      </FilterBlock>
      <FilterBlock label="Range">
        <PillGroup>
          {rangeValues.map((r) => (
            <Pill key={r} active={props.range === r} onClick={() => props.onRange(r)}>
              {r}
            </Pill>
          ))}
        </PillGroup>
      </FilterBlock>
      <FilterBlock label="Search">
        <Input
          value={props.searchValue}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder="code or message"
          className="h-8 w-48"
        />
      </FilterBlock>
      <FilterBlock label="Request ID">
        <Input
          value={props.requestIdValue}
          onChange={(e) => props.onRequestId(e.target.value)}
          placeholder="exact match"
          className="h-8 w-56"
        />
      </FilterBlock>
    </div>
  );
}

function PillGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1">{children}</div>;
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-md border border-border px-2 text-xs capitalize transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// ─── Results table ────────────────────────────────────────────────────────────

function ResultsTable({
  loading,
  records,
  total,
  onSelect,
}: {
  loading: boolean;
  records: ListRecord[];
  total: number;
  onSelect: (id: string) => void;
}) {
  if (loading) return <Skeleton className="h-40" />;
  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
        No logs match these filters.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Time</TableHead>
            <TableHead className="w-24">Severity</TableHead>
            <TableHead className="w-24">Source</TableHead>
            <TableHead className="w-56">Code</TableHead>
            <TableHead>Summary</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r.id)}>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleTimeString()}
              </TableCell>
              <TableCell>
                {r.severity === "error" ? (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <CircleAlertIcon className="size-3.5" />
                    <span className="text-xs font-medium">error</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-yellow-600">
                    <TriangleAlertIcon className="size-3.5" />
                    <span className="text-xs font-medium">warning</span>
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-xs font-normal capitalize">
                  {r.source}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
              <TableCell className="max-w-120 truncate text-sm">{r.devMessage}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {records.length} of {total}
      </div>
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function DetailPanel({
  record,
  onFollowRequestId,
}: {
  record: DetailRecord;
  onFollowRequestId: (rid: string) => void;
}) {
  let prettyContext: string | null = null;
  if (record.context) {
    try {
      prettyContext = JSON.stringify(JSON.parse(record.context), null, 2);
    } catch {
      prettyContext = record.context;
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex items-start gap-2">
        {record.severity === "error" ? (
          <Badge variant="destructive" className="gap-1 text-xs">
            <CircleAlertIcon className="size-3" />
            error
          </Badge>
        ) : (
          <Badge className="gap-1 border border-yellow-500/30 bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/15 text-xs">
            <TriangleAlertIcon className="size-3" />
            warning
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs font-normal capitalize">
          {record.source}
        </Badge>
      </div>

      <p className="text-sm leading-relaxed">{record.devMessage}</p>

      <div className="overflow-hidden rounded-lg border border-border text-xs">
        <MetaRow label="Time" value={new Date(record.createdAt).toLocaleString()} />
        <MetaRow label="Code" value={record.code ?? "—"} mono />
        <MetaRow label="HTTP status" value={record.httpStatus ? String(record.httpStatus) : "—"} />
        <MetaRow label="Route" value={record.route ?? "—"} mono />
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
          <span className="w-28 shrink-0 text-muted-foreground">Request ID</span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              className="min-w-0 truncate font-mono underline-offset-2 hover:underline"
              onClick={() => onFollowRequestId(record.requestId)}
              title="Filter by this request ID"
            >
              {shortRequestId(record.requestId)} ({record.requestId.slice(0, 12)}…)
            </button>
            <button
              type="button"
              title="Filter all logs with this request ID"
              onClick={() => onFollowRequestId(record.requestId)}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLinkIcon className="size-3" />
            </button>
            <CopyButton
              value={record.requestId}
              title="Copy request ID"
              size="icon-xs"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            />
          </div>
        </div>
        {record.userId ? <MetaRow label="User ID" value={record.userId} mono /> : null}
        {record.pluginId ? <MetaRow label="Plugin" value={record.pluginId} mono /> : null}
        {record.connectionId ? (
          <MetaRow label="Connection" value={record.connectionId} mono />
        ) : null}
      </div>

      {record.stack ? (
        <CodeSection label="Stack trace" value={record.stack} maxHeight="max-h-72" />
      ) : null}

      {prettyContext ? (
        <CodeSection label="Context" value={prettyContext} maxHeight="max-h-60" />
      ) : null}
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs last:border-0">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function CodeSection({
  label,
  value,
  maxHeight,
}: {
  label: string;
  value: string;
  maxHeight: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton
          value={value}
          label="Copy"
          size="sm"
          className="h-6 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          iconClassName="size-3"
        />
      </div>
      <pre
        className={cn(
          "overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-[11px] leading-5",
          maxHeight,
        )}
      >
        {value}
      </pre>
    </section>
  );
}
