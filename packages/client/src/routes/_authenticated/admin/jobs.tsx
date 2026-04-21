import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BracesIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleMinusIcon,
  CircleXIcon,
  CogIcon,
  LayersIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
  TimerOffIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CronSchedule } from "@/components/cron-schedule";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/jobs")({
  component: AdminJobsPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type JobRunStatus =
  | "running"
  | "succeeded"
  | "partial_failure"
  | "failed"
  | "skipped"
  | "timed_out"
  | "cancelled";

type JobTriggeredBy = "cron" | "admin" | "user" | "feature";
type JobKind = "scheduled" | "scheduled_per_row" | "triggerable" | "coalesced";

interface JobRunSummary {
  id: string;
  jobId: string;
  scopeKey: string | null;
  status: JobRunStatus;
  triggeredBy: JobTriggeredBy;
  triggeredByUserId: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  requestId: string;
  rowsTotal: number | null;
  rowsSucceeded: number | null;
  rowsFailed: number | null;
  result: string | null;
  coalescedCount: number | null;
}

interface JobHandle {
  id: string;
  kind: JobKind;
  enabled: boolean;
  adminTriggerable: boolean;
  schedule?: string;
  scheduleOverride?: string | null;
  effectiveSchedule?: string;
  lastRun?: JobRunSummary;
  nextRun?: string;
}

type ModalState =
  | { kind: "none" }
  | { kind: "trigger"; job: JobHandle }
  | { kind: "configure"; job: JobHandle };

// ─── Page ─────────────────────────────────────────────────────────────────────

function AdminJobsPage() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const jobsList = useQuery({
    queryKey: ["admin", "jobs", "list"],
    queryFn: async (): Promise<{ jobs: JobHandle[] }> => {
      const res = await api.admin.jobs.$get();
      if (!res.ok) throw new Error("failed to load jobs");
      return (await res.json()) as { jobs: JobHandle[] };
    },
    refetchInterval: 10_000,
  });

  const jobs = jobsList.data?.jobs ?? [];

  const closeModal = () => setModal({ kind: "none" });

  return (
    <div className="flex flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Jobs</h1>
          <p className="max-w-[64ch] text-sm text-muted-foreground">
            Scheduled and triggerable background jobs. Click a row to inspect run history.
          </p>
        </div>
        <RefreshButton onRefresh={() => void jobsList.refetch()} loading={jobsList.isFetching} />
      </header>

      <StatsBar jobs={jobs} loading={jobsList.isLoading} />

      <JobsTable
        jobs={jobs}
        loading={jobsList.isLoading}
        onSelect={setSelectedJobId}
        onTrigger={(job) => setModal({ kind: "trigger", job })}
        onConfigure={(job) => setModal({ kind: "configure", job })}
      />

      <JobDetailSheet jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />

      <TriggerDialog
        open={modal.kind === "trigger"}
        job={modal.kind === "trigger" ? modal.job : null}
        onClose={closeModal}
      />

      <ConfigureDialog
        open={modal.kind === "configure"}
        job={modal.kind === "configure" ? modal.job : null}
        onClose={closeModal}
      />
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ jobs, loading }: { jobs: JobHandle[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-20 rounded-xl" />;

  const running = jobs.filter((j) => j.lastRun?.status === "running").length;
  const failed = jobs.filter(
    (j) => j.lastRun?.status === "failed" || j.lastRun?.status === "partial_failure",
  ).length;
  const disabled = jobs.filter((j) => !j.enabled).length;
  const scheduled = jobs.filter(
    (j) => j.kind === "scheduled" || j.kind === "scheduled_per_row",
  ).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Total jobs" value={jobs.length} />
      <StatCard label="Scheduled" value={scheduled} />
      <StatCard
        label="Currently running"
        value={running}
        accent={running > 0 ? "blue" : undefined}
      />
      <StatCard label="Last run failed" value={failed} accent={failed > 0 ? "red" : undefined} />
      {disabled > 0 && <StatCard label="Disabled" value={disabled} accent="amber" />}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "blue" | "red" | "amber";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border px-4 py-3">
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          accent === "blue" && "text-blue-500",
          accent === "red" && "text-destructive",
          accent === "amber" && "text-amber-500",
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Jobs table ───────────────────────────────────────────────────────────────

function JobsTable({
  jobs,
  loading,
  onSelect,
  onTrigger,
  onConfigure,
}: {
  jobs: JobHandle[];
  loading: boolean;
  onSelect: (id: string) => void;
  onTrigger: (job: JobHandle) => void;
  onConfigure: (job: JobHandle) => void;
}) {
  if (loading) return <Skeleton className="h-64 rounded-xl" />;

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
        No jobs registered.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 pl-4" />
            <TableHead>Job</TableHead>
            <TableHead className="w-32">Kind</TableHead>
            <TableHead className="w-40">Schedule</TableHead>
            <TableHead className="w-36">Last run</TableHead>
            <TableHead className="w-36">Last status</TableHead>
            <TableHead className="w-28 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onSelect={() => onSelect(job.id)}
              onTrigger={() => onTrigger(job)}
              onConfigure={() => onConfigure(job)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function JobRow({
  job,
  onSelect,
  onTrigger,
  onConfigure,
}: {
  job: JobHandle;
  onSelect: () => void;
  onTrigger: () => void;
  onConfigure: () => void;
}) {
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const scopeKey = job.lastRun?.scopeKey ?? undefined;
      const res = await api.admin.jobs[":id"].cancel.$post({
        param: { id: job.id },
        json: scopeKey ? { scopeKey } : undefined,
      });
      if (!res.ok) throw new Error("cancel failed");
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] }),
  });

  const isRunning = job.lastRun?.status === "running";
  const isTriggerable = job.adminTriggerable;

  return (
    <TableRow className="group cursor-pointer" onClick={onSelect}>
      <TableCell className="pl-4 w-8">
        <StatusDot status={job.lastRun?.status} enabled={job.enabled} />
      </TableCell>

      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-sm font-medium">{job.id}</span>
          {!job.enabled && <span className="text-xs text-muted-foreground">disabled</span>}
        </div>
      </TableCell>

      <TableCell>
        <KindBadge kind={job.kind} />
      </TableCell>

      <TableCell className="font-mono text-xs text-muted-foreground">
        {job.effectiveSchedule ?? job.schedule ?? (
          <span className="text-muted-foreground/50">—</span>
        )}
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {job.lastRun ? (
          relativeTime(job.lastRun.startedAt)
        ) : (
          <span className="text-muted-foreground/50">never</span>
        )}
      </TableCell>

      <TableCell>
        {job.lastRun ? (
          <RunStatusBadge status={job.lastRun.status} />
        ) : (
          <span className="text-xs text-muted-foreground/50">—</span>
        )}
      </TableCell>

      <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {isRunning ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              title="Cancel run"
              className="text-destructive hover:text-destructive"
            >
              <SquareIcon className="size-3.5" />
            </Button>
          ) : isTriggerable ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onTrigger}
              disabled={!job.enabled}
              title="Run now"
            >
              <PlayIcon className="size-3.5" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={onConfigure} title="Configure">
            <CogIcon className="size-3.5" />
          </Button>
          <ChevronRightIcon className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Job detail sheet ─────────────────────────────────────────────────────────

function JobDetailSheet({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const detail = useQuery({
    enabled: !!jobId,
    queryKey: ["admin", "jobs", "detail", jobId],
    queryFn: async (): Promise<{ job: JobHandle; runs: JobRunSummary[] }> => {
      const res = await api.admin.jobs[":id"].$get({
        param: { id: jobId! },
        query: { limit: "30" },
      });
      if (!res.ok) throw new Error("failed to load job");
      return (await res.json()) as { job: JobHandle; runs: JobRunSummary[] };
    },
    refetchInterval: jobId ? 5_000 : false,
  });

  const job = detail.data?.job;
  const runs = detail.data?.runs ?? [];

  return (
    <Sheet open={!!jobId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-130 sm:max-w-130 flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <SheetTitle className="font-mono text-base truncate">{jobId}</SheetTitle>
              {job && <KindBadge kind={job.kind} />}
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {detail.isLoading ? (
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-48 rounded-lg" />
            </div>
          ) : job ? (
            <div className="flex flex-col gap-6 p-6">
              <JobMetaSection job={job} />
              <RunHistorySection runs={runs} />
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JobMetaSection({ job }: { job: JobHandle }) {
  const schedule = job.effectiveSchedule ?? job.schedule;
  const isScheduled = job.kind === "scheduled" || job.kind === "scheduled_per_row";

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border text-xs">
        <MetaRow label="Status" value={job.enabled ? "Enabled" : "Disabled"} />
        {job.lastRun && (
          <MetaRow label="Last run" value={new Date(job.lastRun.startedAt).toLocaleString()} />
        )}
        {job.lastRun?.durationMs != null && (
          <MetaRow label="Last duration" value={formatDuration(job.lastRun.durationMs)} />
        )}
        {job.scheduleOverride && (
          <MetaRow label="Schedule override" value={job.scheduleOverride} mono />
        )}
      </div>

      {isScheduled && schedule && isValidCron(schedule) && (
        <CronSchedule expression={schedule} showNextRuns={3} />
      )}
    </div>
  );
}

function RunHistorySection({ runs }: { runs: JobRunSummary[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No runs recorded yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Run history
      </h3>
      <div className="divide-y divide-border rounded-lg border border-border">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: JobRunSummary }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-xs">
      <RunStatusIcon status={run.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{runStatusLabel(run.status)}</span>
          <span className="text-muted-foreground">·</span>
          <span className="capitalize text-muted-foreground">{run.triggeredBy}</span>
          {run.coalescedCount != null && run.coalescedCount > 1 && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{run.coalescedCount} coalesced</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{relativeTime(run.startedAt)}</span>
          {run.durationMs != null && (
            <>
              <span>·</span>
              <span>{formatDuration(run.durationMs)}</span>
            </>
          )}
          {run.rowsTotal != null && (
            <>
              <span>·</span>
              <span>
                {run.rowsSucceeded ?? 0}/{run.rowsTotal} rows
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Trigger dialog ───────────────────────────────────────────────────────────

function TriggerDialog({
  open,
  job,
  onClose,
}: {
  open: boolean;
  job: JobHandle | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setRunId(null);
  }, [open]);

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.jobs[":id"].trigger.$post({
        param: { id: job!.id },
        json: null,
      });
      if (!res.ok) throw new Error("trigger failed");
      return res.json() as Promise<{ runId?: string }>;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      if (data && "runId" in data && data.runId) {
        setRunId(data.runId);
      } else {
        onClose();
      }
    },
  });

  const hasResult = !!runId;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{hasResult ? "Job started" : "Run job"}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{job?.id}</DialogDescription>
        </DialogHeader>

        {hasResult ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" />
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                Job dispatched successfully.
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-border text-xs">
              <MetaRow label="Run ID" value={runId!} mono />
            </div>
          </div>
        ) : (
          <div className="py-2 text-sm text-muted-foreground">
            This will immediately start a new run of{" "}
            <span className="font-mono text-foreground">{job?.id}</span>, bypassing its schedule.
          </div>
        )}

        <DialogFooter>
          {hasResult ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
                {triggerMutation.isPending ? (
                  <>
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-3.5" />
                    Run now
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Configure dialog ─────────────────────────────────────────────────────────

function ConfigureDialog({
  open,
  job,
  onClose,
}: {
  open: boolean;
  job: JobHandle | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [scheduleOverride, setScheduleOverride] = useState(job?.scheduleOverride ?? "");

  useEffect(() => {
    if (job) {
      setEnabled(job.enabled);
      setScheduleOverride(job.scheduleOverride ?? "");
    }
  }, [job?.id]);

  const isScheduled = job?.kind === "scheduled" || job?.kind === "scheduled_per_row";
  const previewExpression = scheduleOverride.trim() || job?.schedule || "";
  const showCronPreview = isScheduled && isValidCron(previewExpression);

  const configMutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.jobs[":id"].config.$post({
        param: { id: job!.id },
        json: {
          enabled,
          scheduleOverride: scheduleOverride.trim() || null,
        },
      });
      if (!res.ok) throw new Error("config update failed");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Configure job</DialogTitle>
          <DialogDescription className="font-mono text-xs">{job?.id}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <Field orientation="horizontal" className="max-w-sm">
            <FieldContent>
              <FieldLabel htmlFor="enabled">Enabled</FieldLabel>
              <FieldDescription>
                Allow this job to run on schedule or be triggered.
              </FieldDescription>
            </FieldContent>
            <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
          </Field>

          {isScheduled && (
            <Field>
              <FieldTitle>Schedule override</FieldTitle>
              <FieldDescription>
                Cron expression to replace the default schedule. Leave blank to use the default
                {job?.schedule ? (
                  <>
                    {" ("}
                    <span className="font-mono">{job.schedule}</span>
                    {")"}
                  </>
                ) : null}
                .
              </FieldDescription>
              <Input
                placeholder={job?.schedule ?? "e.g. 0 */6 * * *"}
                value={scheduleOverride}
                onChange={(e) => setScheduleOverride(e.target.value)}
                className="font-mono text-sm"
              />
              {showCronPreview && (
                <CronSchedule expression={previewExpression} showNextRuns={3} className="mt-2" />
              )}
            </Field>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => configMutation.mutate()} disabled={configMutation.isPending}>
            {configMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function StatusDot({ status, enabled }: { status: JobRunStatus | undefined; enabled: boolean }) {
  if (!enabled) {
    return <span className="block size-2 rounded-full bg-muted-foreground/30" />;
  }
  if (!status) {
    return <span className="block size-2 rounded-full bg-muted-foreground/20" />;
  }
  return (
    <span
      className={cn(
        "block size-2 rounded-full",
        status === "running" && "animate-pulse bg-blue-500",
        status === "succeeded" && "bg-emerald-500",
        status === "partial_failure" && "bg-amber-500",
        status === "failed" && "bg-destructive",
        status === "timed_out" && "bg-amber-500",
        status === "skipped" && "bg-muted-foreground/40",
        status === "cancelled" && "bg-muted-foreground/40",
      )}
    />
  );
}

function RunStatusIcon({ status }: { status: JobRunStatus }) {
  const classes = cn(
    "size-3.5 shrink-0",
    status === "running" && "text-blue-500",
    status === "succeeded" && "text-emerald-500",
    status === "partial_failure" && "text-amber-500",
    status === "failed" && "text-destructive",
    status === "timed_out" && "text-amber-500",
    status === "skipped" && "text-muted-foreground/50",
    status === "cancelled" && "text-muted-foreground/50",
  );

  if (status === "running") return <RefreshCwIcon className={cn(classes, "animate-spin")} />;
  if (status === "succeeded") return <CircleCheckIcon className={classes} />;
  if (status === "partial_failure") return <TriangleAlertIcon className={classes} />;
  if (status === "failed") return <CircleXIcon className={classes} />;
  if (status === "timed_out") return <TimerOffIcon className={classes} />;
  if (status === "skipped") return <CircleMinusIcon className={classes} />;
  if (status === "cancelled") return <CircleMinusIcon className={classes} />;
  return <CircleDotIcon className={classes} />;
}

function RunStatusBadge({ status }: { status: JobRunStatus }) {
  const label = runStatusLabel(status);

  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-500">
        <RefreshCwIcon className="size-3 animate-spin" />
        {label}
      </span>
    );
  }
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
        <CircleCheckIcon className="size-3" />
        {label}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <CircleXIcon className="size-3" />
        {label}
      </span>
    );
  }
  if (status === "partial_failure" || status === "timed_out") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
        <TriangleAlertIcon className="size-3" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleMinusIcon className="size-3" />
      {label}
    </span>
  );
}

function KindBadge({ kind }: { kind: JobKind }) {
  const meta: Record<JobKind, { label: string; icon: React.ReactNode }> = {
    scheduled: {
      label: "Scheduled",
      icon: <CalendarClockIcon className="size-3" />,
    },
    scheduled_per_row: {
      label: "Per row",
      icon: <LayersIcon className="size-3" />,
    },
    triggerable: { label: "Triggerable", icon: <ZapIcon className="size-3" /> },
    coalesced: { label: "Coalesced", icon: <BracesIcon className="size-3" /> },
  };
  const { label, icon } = meta[kind];
  return (
    <Badge variant="secondary" className="gap-1 text-xs font-normal">
      {icon}
      {label}
    </Badge>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs last:border-0">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function RefreshButton({ onRefresh, loading }: { onRefresh: () => void; loading: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
      <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
      Refresh
    </Button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidCron(expression: string): boolean {
  return expression.trim().split(/\s+/).length === 5;
}

function runStatusLabel(status: JobRunStatus): string {
  const labels: Record<JobRunStatus, string> = {
    running: "Running",
    succeeded: "Succeeded",
    partial_failure: "Partial failure",
    failed: "Failed",
    skipped: "Skipped",
    timed_out: "Timed out",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1_000);
  return `${min}m ${sec}s`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
