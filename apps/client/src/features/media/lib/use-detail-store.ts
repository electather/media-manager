import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { FeedbackVote } from "./types";
import type { RequestRecord } from "@/features/requests";

const DETAIL_STATE_KEY = ["media-details", "client-state"] as const;

interface DetailState {
  watched: string[];
  watchlist: string[];
  notes: Record<string, string>;
  votes: Record<string, FeedbackVote>;
  requests: Record<string, RequestRecord>;
  seasonRequests: Record<string, Record<string, unknown>>;
  trailerId: string | null;
}

const INITIAL: DetailState = {
  watched: [],
  watchlist: [],
  notes: {},
  votes: {},
  requests: {},
  seasonRequests: {},
  trailerId: null,
};

// Local client store backed by React Query cache. Replaced by RPC mutations
// in T44 — for now we treat the cache as the source of truth so subsequent
// renders stay consistent across components.
export function useDetailStore() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: DETAIL_STATE_KEY,
    queryFn: () => INITIAL,
    initialData: INITIAL,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const update = useCallback(
    (patch: (prev: DetailState) => DetailState) => {
      qc.setQueryData<DetailState>(DETAIL_STATE_KEY, (prev) => patch(prev ?? INITIAL));
    },
    [qc],
  );

  const role: "user" | "admin" = "user";
  const pluginConfigured = false;
  const defaultDestination = { serviceId: "radarr", profileId: "1080p" };

  const watched = new Set(data.watched);
  const watchlist = new Set(data.watchlist);

  const toggleWatched = (id: string) =>
    update((p) => ({
      ...p,
      watched: watched.has(id) ? p.watched.filter((x) => x !== id) : [...p.watched, id],
    }));

  const toggleWatchlist = (id: string) =>
    update((p) => ({
      ...p,
      watchlist: watchlist.has(id) ? p.watchlist.filter((x) => x !== id) : [...p.watchlist, id],
    }));

  const setNote = (id: string, body: string) =>
    update((p) => {
      const next = { ...p.notes };
      if (body) next[id] = body;
      else delete next[id];
      return { ...p, notes: next };
    });

  const setVote = (id: string, vote: FeedbackVote) =>
    update((p) => {
      const next = { ...p.votes };
      if (vote) next[id] = vote;
      else delete next[id];
      return { ...p, votes: next };
    });

  const openTrailer = (id: string) => update((p) => ({ ...p, trailerId: id }));
  const closeTrailer = () => update((p) => ({ ...p, trailerId: null }));

  const submitRequest = (id: string, _dest: typeof defaultDestination) => {
    toast("Request submitted");
    update((p) => ({
      ...p,
      requests: {
        ...p.requests,
        [id]: {
          itemId: id,
          status: "pending",
          destination: { ...defaultDestination, serviceLabel: "Radarr", profileLabel: "1080p" },
        },
      },
    }));
  };

  const cancelRequest = (id: string) => {
    toast("Request cancelled");
    update((p) => {
      const next = { ...p.requests };
      delete next[id];
      return { ...p, requests: next };
    });
  };

  const showToast = (message: string) => toast(message);

  return {
    watched,
    watchlist,
    notes: data.notes,
    votes: data.votes,
    requests: data.requests,
    seasonRequests: data.seasonRequests,
    trailerId: data.trailerId,
    role,
    pluginConfigured,
    defaultDestination,
    toggleWatched,
    toggleWatchlist,
    setNote,
    setVote,
    openTrailer,
    closeTrailer,
    submitRequest,
    cancelRequest,
    showToast,
  };
}

// `useMutation` style for vote/note when we hook RPC later. Re-export here to
// keep the swap-out surface small.
export function useDetailMutations() {
  const noop = useMutation({ mutationFn: async (_p: unknown) => undefined });
  return { noop };
}

// Tracks the "loading skeleton" flag per peek change. Mirrors the simulated
// fetch in the source prototype.
export function useSimulatedFetch(open: boolean, peekId: string | null) {
  const [loading, setLoading] = useState(false);
  const key = `${open ? "1" : "0"}:${peekId ?? ""}`;
  return { loading, setLoading, key };
}
