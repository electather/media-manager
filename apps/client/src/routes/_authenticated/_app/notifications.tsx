import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { fetchInboxPage } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import {
  NotificationsErrorBoundary,
  NotificationsErrorFallback,
} from "@/features/notifications/shared/error-boundary";
import { InboxPage } from "@/features/notifications/inbox/inbox-page";
import { InboxSkeleton } from "@/features/notifications/inbox/inbox-skeleton";
import type { InboxFilters } from "@/features/notifications/shared/types";

const inboxSearchSchema = z
  .object({
    unreadOnly: z.boolean().optional(),
    category: z.enum(["media", "sync", "auth", "system"]).optional(),
    severity: z.enum(["info", "warn", "error"]).optional(),
  })
  .strict();

type InboxSearch = z.infer<typeof inboxSearchSchema>;

function searchToFilters(s: InboxSearch): InboxFilters {
  const out: InboxFilters = {};
  if (s.unreadOnly) out.unreadOnly = true;
  if (s.category) out.category = s.category;
  if (s.severity) out.severity = s.severity;
  return out;
}

export const Route = createFileRoute("/_authenticated/_app/notifications")({
  validateSearch: inboxSearchSchema,
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps: { search } }) => {
    const filters = searchToFilters(search);
    return queryClient.ensureInfiniteQueryData({
      queryKey: notificationsKeys.inbox(filters),
      queryFn: ({ pageParam }) => fetchInboxPage(filters, pageParam ?? null),
      initialPageParam: null as string | null,
      getNextPageParam: (last: { nextCursor?: string }) =>
        typeof last.nextCursor === "string" ? last.nextCursor : null,
    });
  },
  pendingComponent: InboxSkeleton,
  errorComponent: NotificationsErrorFallback,
  component: InboxRoute,
});

function InboxRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const filters = searchToFilters(search);
  return (
    <NotificationsErrorBoundary>
      <InboxPage
        filters={filters}
        onFiltersChange={(next) => {
          void navigate({
            to: Route.fullPath,
            search: {
              ...(next.unreadOnly ? { unreadOnly: true } : {}),
              ...(next.category ? { category: next.category } : {}),
              ...(next.severity ? { severity: next.severity } : {}),
            },
          });
        }}
      />
    </NotificationsErrorBoundary>
  );
}
