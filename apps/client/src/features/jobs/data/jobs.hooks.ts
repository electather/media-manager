import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { eq, ilike, useLiveQuery } from "@tanstack/react-db";
import type { JobHandle, JobRunStatus, JobRunSummary } from "@ent-mcp/shared/jobs";
import { api } from "@/shared/lib/api";
import { useCollection } from "@/shared/lib/db";
import { jobsListCollection } from "./jobs-list.collection";
import { jobRunsRegistry } from "./job-runs.collection";
import { decrementDrawerOpen, incrementDrawerOpen } from "./poll-signal";

interface JobsListFilters {
  search?: string;
  kind?: string;
}

export function useJobsList(filters: JobsListFilters = {}) {
  const search = (filters.search ?? "").trim().toLowerCase();
  const kind = filters.kind && filters.kind !== "all" ? filters.kind : undefined;
  return useLiveQuery(
    (q) => {
      let base = q.from({ job: jobsListCollection });
      if (search) {
        base = base.where(({ job }) => ilike(job.id, `%${search}%`));
      }
      if (kind) {
        base = base.where(({ job }) => eq(job.kind, kind));
      }
      return base;
    },
    [search, kind],
  );
}

/**
 * Reads a single job from the list collection. No detail fetch — the list
 * already carries the full handle. `listLoading` lets callers show a spinner
 * during deep-link cold-loads where the row is not yet in the list.
 */
export function useJobDetail(jobId: string | null) {
  const list = useLiveQuery(
    (q) =>
      jobId ? q.from({ job: jobsListCollection }).where(({ job }) => eq(job.id, jobId)) : null,
    [jobId],
  );
  const data = list.data?.[0] as JobHandle | undefined;
  return {
    data,
    isLoading: jobId ? !data && list.isLoading : false,
    listStatus: list.status,
  };
}

export function useJobRuns(jobId: string | null) {
  const collection = useCollection(jobRunsRegistry, jobId);
  const live = useLiveQuery((q) => (collection ? q.from({ run: collection }) : null), [collection]);
  return {
    data: (live.data as JobRunSummary[] | undefined) ?? [],
    isLoading: !!jobId && (collection ? live.isLoading : true),
  };
}

/**
 * Increments the drawer-open signal so the list collection polls at 5s
 * cadence while the drawer is mounted.
 */
export function useDrawerPollBoost(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    incrementDrawerOpen();
    return () => decrementDrawerOpen();
  }, [active]);
}

function optimisticRun(jobId: string, status: JobRunStatus): JobRunSummary {
  const now = Date.now();
  return {
    id: `optimistic-${now}`,
    jobId,
    scopeKey: null,
    status,
    triggeredBy: "admin",
    triggeredByUserId: null,
    startedAt: now,
    finishedAt: null,
    durationMs: null,
    requestId: "optimistic",
    rowsTotal: null,
    rowsSucceeded: null,
    rowsFailed: null,
    errorRecordId: null,
    result: null,
    logs: null,
    logsTruncated: 0,
    coalescedCount: null,
  };
}

export function useJobMutations() {
  const triggerMutation = useMutation({
    mutationFn: async (vars: { id: string; input?: Record<string, unknown> | null }) => {
      const res = await api.admin.jobs[":id"].trigger.$post({
        param: { id: vars.id },
        json: vars.input ?? null,
      });
      if (!res.ok) throw new Error("trigger failed");
      return (await res.json()) as { runId?: string };
    },
    onMutate: ({ id }) => {
      const collection = jobRunsRegistry.peek(id);
      if (!collection) return;
      const optimistic = optimisticRun(id, "running");
      collection.utils.writeInsert(optimistic);
      return { id, optimisticId: optimistic.id };
    },
    onSettled: (_data, _err, _vars, ctx) => {
      if (!ctx) return;
      const collection = jobRunsRegistry.peek(ctx.id);
      collection?.utils.writeDelete(ctx.optimisticId);
      void collection?.utils.refetch();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (vars: { id: string; scopeKey?: string }) => {
      const res = await api.admin.jobs[":id"].cancel.$post({
        param: { id: vars.id },
        json: vars.scopeKey ? { scopeKey: vars.scopeKey } : undefined,
      });
      if (!res.ok) throw new Error("cancel failed");
      return (await res.json()) as { ok: boolean };
    },
    onMutate: ({ id }) => {
      const collection = jobRunsRegistry.peek(id);
      if (!collection) return;
      const running = [...collection.values()].find((run) => run.status === "running") as
        | JobRunSummary
        | undefined;
      if (!running) return;
      collection.utils.writeUpdate({ ...running, status: "cancelled" });
      return { id, runId: running.id, previousStatus: running.status };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      const collection = jobRunsRegistry.peek(ctx.id);
      collection?.utils.writeUpdate({ id: ctx.runId, status: ctx.previousStatus });
    },
    onSettled: (_data, _err, vars) => {
      void jobRunsRegistry.peek(vars.id)?.utils.refetch();
      void jobsListCollection.utils.refetch();
    },
  });

  const toggleEnabled = (id: string, next: boolean) => {
    jobsListCollection.update(id, (draft) => {
      draft.enabled = next;
    });
  };
  const setScheduleOverride = (id: string, next: string | null) => {
    jobsListCollection.update(id, (draft) => {
      draft.scheduleOverride = next;
    });
  };
  const saveConfig = (
    id: string,
    patch: { enabled?: boolean; scheduleOverride?: string | null },
  ) => {
    jobsListCollection.update(id, (draft) => {
      if (patch.enabled !== undefined) {
        draft.enabled = patch.enabled;
      }
      if ("scheduleOverride" in patch) {
        draft.scheduleOverride = patch.scheduleOverride;
      }
    });
  };

  const refreshList = () => {
    void jobsListCollection.utils.refetch();
  };

  return {
    toggleEnabled,
    setScheduleOverride,
    saveConfig,
    refreshList,
    trigger: triggerMutation,
    cancel: cancelMutation,
  };
}
