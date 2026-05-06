import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { fetchAdminDeliveriesPage } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import { NotificationsErrorBoundary } from "@/features/notifications/shared/error-boundary";
import { DeliveriesPage } from "@/features/notifications/admin/deliveries-page";
import { DeliveriesSkeleton } from "@/features/notifications/admin/deliveries-skeleton";
import type { AdminDeliveryFilters } from "@/features/notifications/shared/types";

const adminSearchSchema = z
  .object({
    status: z.enum(["pending", "in_progress", "succeeded", "failed"]).optional(),
    category: z.enum(["media", "sync", "auth", "system"]).optional(),
    severity: z.enum(["info", "warn", "error"]).optional(),
    recipientUserId: z.string().optional(),
    from: z.number().optional(),
    to: z.number().optional(),
    id: z.string().optional(),
  })
  .strict();

type AdminSearch = z.infer<typeof adminSearchSchema>;

function searchToFilters(s: AdminSearch): AdminDeliveryFilters {
  const out: AdminDeliveryFilters = {};
  if (s.status) out.status = s.status;
  if (s.category) out.category = s.category;
  if (s.severity) out.severity = s.severity;
  if (s.recipientUserId) out.recipientUserId = s.recipientUserId;
  if (s.from !== undefined) out.from = s.from;
  if (s.to !== undefined) out.to = s.to;
  return out;
}

export const Route = createFileRoute("/_authenticated/_settings/admin/notifications/deliveries")({
  validateSearch: adminSearchSchema,
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps: { search } }) => {
    const filters = searchToFilters(search);
    return queryClient.ensureInfiniteQueryData({
      queryKey: notificationsKeys.admin.deliveries(filters),
      queryFn: ({ pageParam }) => fetchAdminDeliveriesPage(filters, pageParam ?? null),
      initialPageParam: null as string | null,
      getNextPageParam: (last: { nextCursor?: string }) =>
        typeof last.nextCursor === "string" ? last.nextCursor : null,
    });
  },
  pendingComponent: DeliveriesSkeleton,
  errorComponent: ({ error }) => (
    <NotificationsErrorBoundary>
      <div className="p-6">{error.message}</div>
    </NotificationsErrorBoundary>
  ),
  component: AdminDeliveriesRoute,
});

function AdminDeliveriesRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const filters = searchToFilters(search);
  const id = search.id ?? null;

  const setSearch = (next: AdminDeliveryFilters & { id?: string | null }) => {
    void navigate({
      to: Route.fullPath,
      search: {
        ...(next.status ? { status: next.status } : {}),
        ...(next.category ? { category: next.category } : {}),
        ...(next.severity ? { severity: next.severity } : {}),
        ...(next.recipientUserId ? { recipientUserId: next.recipientUserId } : {}),
        ...(next.from !== undefined ? { from: next.from } : {}),
        ...(next.to !== undefined ? { to: next.to } : {}),
        ...(next.id ? { id: next.id } : {}),
      },
    });
  };

  return (
    <NotificationsErrorBoundary>
      <DeliveriesPage
        filters={filters}
        selectedId={id}
        onFiltersChange={(next) => setSearch({ ...next, id: id ?? undefined })}
        onSelect={(nextId) => setSearch({ ...filters, id: nextId ?? undefined })}
      />
    </NotificationsErrorBoundary>
  );
}
