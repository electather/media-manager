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

/**
 * Shared optimistic-mutation shape for inbox writes: snapshot every inbox
 * query, apply `update` to each page, restore on error, invalidate inbox +
 * unread-count once settled. Lets each hook just declare its fetcher + the
 * cache transform.
 */
function useOptimisticInboxMutation<TInput>(args: {
  mutationFn: (input: TInput) => Promise<unknown>;
  update: (data: InboxLikeData | undefined, input: TInput) => InboxLikeData | undefined;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: args.mutationFn,
    onMutate: async (input: TInput) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.inboxAll() });
      const snapshot = snapshotInbox(qc);
      qc.setQueriesData<InboxLikeData>({ queryKey: notificationsKeys.inboxAll() }, (data) =>
        args.update(data, input),
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) restore(qc, ctx.snapshot);
    },
    onSettled: () => invalidateInboxAndCount(qc),
  });
}

export type MarkReadMutation = ReturnType<typeof useMarkRead>;

export function useMarkRead() {
  return useOptimisticInboxMutation({
    mutationFn: (ids: string[]) => fetchMarkRead(ids),
    update: (data, ids) => applyToPages(data, setReadAt(new Set(ids), Date.now())),
  });
}

export function useMarkUnread() {
  return useOptimisticInboxMutation({
    mutationFn: (ids: string[]) => fetchMarkUnread(ids),
    update: (data, ids) => applyToPages(data, setReadAt(new Set(ids), null)),
  });
}

export function useDismiss() {
  return useOptimisticInboxMutation({
    mutationFn: (ids: string[]) => fetchDismiss(ids),
    update: (data, ids) => applyToPages(data, removeIds(new Set(ids))),
  });
}

export function useMarkAllRead() {
  return useOptimisticInboxMutation({
    mutationFn: (input: { category?: NotificationCategory }) => fetchMarkAllRead(input),
    update: (data, input) => markAllReadUpdate(data, input.category),
  });
}

function markAllReadUpdate(
  data: InboxLikeData | undefined,
  category: NotificationCategory | undefined,
): InboxLikeData | undefined {
  const now = Date.now();
  return applyToPages(data, (items) =>
    items.map((i) =>
      (!category || i.category === category) && i.readAt === null ? { ...i, readAt: now } : i,
    ),
  );
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
