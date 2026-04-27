import type { HomeRowStub } from "@ent-mcp/shared/home";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRowPagination } from "@/hooks/use-row-pagination";
import { SidebarItem } from "./sidebar-item";

/**
 * Sidebar column for the top zone. Layout switches via container query
 * against the top-zone's `@container` (top-zone-toplevel) rather than a
 * `useMediaQuery` hook so the override is hydration-safe and matches the
 * grid-cols-1 vs grid-cols-2 threshold the top-zone uses for its own
 * collapse.
 *
 * - Default (top-zone container `<768px`, top-zone collapsed to one column):
 *   horizontal-scroll backdrop row matching the design doc's "< md: stack"
 *   guidance. Each item gets a fixed slide width so the row scrolls
 *   smoothly without items shrinking.
 * - `@[768px]+` (top-zone container `≥768px`, sidebar slot has dedicated
 *   width): traditional vertical list.
 */
export function SidebarColumn({ row }: { row: HomeRowStub }) {
  const title = row.titleOverride ?? row.title;
  const { items, isPending } = useRowPagination({
    rowId: row.rowId,
    initialCursor: row.initialCursor,
  });

  return (
    <section
      aria-labelledby={`sidebar-${row.rowId}`}
      data-testid="sidebar-column"
      className="flex flex-col gap-3"
    >
      <h2
        id={`sidebar-${row.rowId}`}
        data-testid="sidebar-title"
        className="text-[15px] font-medium text-foreground"
      >
        {title}
      </h2>
      <div
        data-testid="sidebar-list"
        className={cn(
          "flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]",
          "@[768px]:flex-col @[768px]:gap-2 @[768px]:overflow-visible @[768px]:pb-0",
        )}
      >
        {isPending
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="shrink-0 w-[280px] @[768px]:w-auto @[768px]:shrink">
                <Skeleton className="aspect-video w-full" />
              </div>
            ))
          : items.map((item) => (
              <div key={item.id} className="shrink-0 w-[280px] @[768px]:w-auto @[768px]:shrink">
                <SidebarItem item={item} />
              </div>
            ))}
      </div>
    </section>
  );
}
