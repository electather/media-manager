import { Suspense, useState } from "react";
import { m } from "@/paraglide/messages";
import { useUnreadCount } from "../bell/use-unread-count";
import { InboxBulkBar } from "./inbox-bulk-bar";
import { InboxList } from "./inbox-list";
import { InboxSkeleton } from "./inbox-skeleton";
import { InboxToolbar } from "./inbox-toolbar";
import type { InboxFilters } from "../shared/types";

interface Props {
  filters: InboxFilters;
  onFiltersChange: (next: InboxFilters) => void;
}

export function InboxPage({ filters, onFiltersChange }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.count ?? 0;

  const onToggle = (id: string, isSelected: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 pt-6 pb-3">
        <div>
          <h1 className="text-2xl font-semibold">{m.notifications_page_title()}</h1>
          <p className="text-sm text-muted-foreground">
            {m.notifications_page_subtitle_unread({ count: unreadCount })}
          </p>
        </div>
      </header>
      <InboxToolbar
        filters={filters}
        unreadCount={unreadCount}
        onFiltersChange={(next) => {
          setSelected(new Set());
          onFiltersChange(next);
        }}
      />
      <Suspense fallback={<InboxSkeleton />}>
        <InboxList filters={filters} selected={selected} onToggleSelect={onToggle} />
      </Suspense>
      <InboxBulkBar ids={Array.from(selected)} onClear={() => setSelected(new Set())} />
    </div>
  );
}
