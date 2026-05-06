import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NotificationCategory } from "@ent-mcp/shared/notifications";
import { m } from "@/paraglide/messages";
import {
  fetchDeleteInboxAll,
  fetchDismiss,
  fetchMarkAllRead,
  fetchMarkRead,
  fetchMarkUnread,
} from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { NotificationItemDto } from "../shared/types";

interface InboxLikePage {
  items: NotificationItemDto[];
  unreadCount: number;
  nextCursor?: string;
}

interface InboxLikeData {
  pages?: InboxLikePage[];
  items?: NotificationItemDto[];
  unreadCount?: number;
  pageParams?: unknown[];
}

function applyToPages(
  data: InboxLikeData | undefined,
  fn: (items: NotificationItemDto[]) => NotificationItemDto[],
): InboxLikeData | undefined {
  if (!data) return data;
  if (Array.isArray(data.pages)) {
    return { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items) })) };
  }
  if (Array.isArray(data.items)) {
    return { ...data, items: fn(data.items) };
  }
  return data;
}

function setReadAt(
  ids: ReadonlySet<string>,
  readAt: number | null,
): (items: NotificationItemDto[]) => NotificationItemDto[] {
  return (items) => items.map((i) => (ids.has(i.id) ? { ...i, readAt } : i));
}

function removeIds(
  ids: ReadonlySet<string>,
): (items: NotificationItemDto[]) => NotificationItemDto[] {
  return (items) => items.filter((i) => !ids.has(i.id));
}

function snapshotInbox(qc: ReturnType<typeof useQueryClient>) {
  return qc.getQueriesData<InboxLikeData>({ queryKey: notificationsKeys.inboxAll() });
}

function restore(
  qc: ReturnType<typeof useQueryClient>,
  snapshot: ReturnType<typeof snapshotInbox>,
) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

function invalidateInboxAndCount(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: notificationsKeys.inboxAll() });
  void qc.invalidateQueries({ queryKey: notificationsKeys.unreadCount() });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => fetchMarkRead(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.inboxAll() });
      const snapshot = snapshotInbox(qc);
      const idSet = new Set(ids);
      const now = Date.now();
      qc.setQueriesData<InboxLikeData>({ queryKey: notificationsKeys.inboxAll() }, (data) =>
        applyToPages(data, setReadAt(idSet, now)),
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) restore(qc, ctx.snapshot);
    },
    onSettled: () => invalidateInboxAndCount(qc),
  });
}

export function useMarkUnread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => fetchMarkUnread(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.inboxAll() });
      const snapshot = snapshotInbox(qc);
      const idSet = new Set(ids);
      qc.setQueriesData<InboxLikeData>({ queryKey: notificationsKeys.inboxAll() }, (data) =>
        applyToPages(data, setReadAt(idSet, null)),
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) restore(qc, ctx.snapshot);
    },
    onSettled: () => invalidateInboxAndCount(qc),
  });
}

export function useDismiss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => fetchDismiss(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.inboxAll() });
      const snapshot = snapshotInbox(qc);
      const idSet = new Set(ids);
      qc.setQueriesData<InboxLikeData>({ queryKey: notificationsKeys.inboxAll() }, (data) =>
        applyToPages(data, removeIds(idSet)),
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) restore(qc, ctx.snapshot);
    },
    onSettled: () => invalidateInboxAndCount(qc),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { category?: NotificationCategory }) => fetchMarkAllRead(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.inboxAll() });
      const snapshot = snapshotInbox(qc);
      const now = Date.now();
      qc.setQueriesData<InboxLikeData>({ queryKey: notificationsKeys.inboxAll() }, (data) =>
        applyToPages(data, (items) =>
          items.map((i) =>
            (!input.category || i.category === input.category) && i.readAt === null
              ? { ...i, readAt: now }
              : i,
          ),
        ),
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) restore(qc, ctx.snapshot);
    },
    onSettled: () => invalidateInboxAndCount(qc),
  });
}

export function useDeleteInboxAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { readOnly?: boolean; olderThan?: string }) => fetchDeleteInboxAll(input),
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.notifications_bulk_delete_failed({ message: msg }));
    },
    onSettled: () => invalidateInboxAndCount(qc),
  });
}
