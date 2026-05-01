import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eq, ilike, useLiveQuery } from "@tanstack/react-db";
import type { JobHandle } from "@ent-mcp/shared/jobs";
import { api } from "@/shared/lib/api";
import { jobsListCollection } from "./jobs-list.collection";
import { jobDetailCollection } from "./job-detail.collection";

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

export function useJobDetail(jobId: string | null) {
  const collection = useMemo(() => (jobId ? jobDetailCollection(jobId) : null), [jobId]);

  // Release the collection when the drawer closes or the user opens a different
  // job. Without this the per-id factory leaks one collection per opened job
  // for the lifetime of the admin session.
  const previousRef = useRef<typeof collection>(null);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = collection;
    return () => {
      void previous?.cleanup();
    };
  }, [collection]);

  const live = useLiveQuery((q) => (collection ? q.from({ job: collection }) : null), [collection]);

  const data = collection ? (live.data?.[0] as JobHandle | undefined) : undefined;
  return {
    data,
    // Treat seeded data as ready: when the cache is primed from the list, the
    // live query emits the row on its first frame even though the underlying
    // status is still "loading" until the background refetch resolves.
    isLoading: !data && (collection ? live.isLoading : false),
  };
}

export function useJobMutations() {
  const queryClient = useQueryClient();

  const triggerMutation = useMutation({
    mutationFn: async (vars: { id: string; input?: Record<string, unknown> | null }) => {
      const res = await api.admin.jobs[":id"].trigger.$post({
        param: { id: vars.id },
        json: vars.input ?? null,
      });
      if (!res.ok) throw new Error("trigger failed");
      return (await res.json()) as { runId?: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
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
