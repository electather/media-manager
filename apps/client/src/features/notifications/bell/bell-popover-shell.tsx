import { Suspense, startTransition, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheckIcon, RotateCcwIcon, SettingsIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { NotificationCategory } from "@ent-mcp/shared/notifications";
import { isNil } from "es-toolkit/predicate";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { RadioGroup } from "@/shared/ui/radio-group";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { m } from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import {
  ErrorState,
  ErrorStateActions,
  ErrorStateContent,
  ErrorStateDescription,
  ErrorStateMedia,
  ErrorStateTitle,
} from "@/shared/components/error-state";
import { CategoryChip } from "../shared/category-chip";
import { PopoverEmpty } from "./popover-empty";
import { PopoverRow } from "./popover-row";
import { PopoverSkeleton } from "./popover-skeleton";
import { usePopoverInbox } from "./use-popover-inbox";
import { useMarkAllRead } from "../inbox/use-inbox-mutations";
import { notificationsKeys } from "../shared/query-keys";
import { CATEGORY_META, categoryLabel } from "../shared/types";
import type { Density, Intensity, NotificationItemDto } from "../shared/types";

type Filter = "all" | NotificationCategory;
type CountKey = Filter | "unread";
type Counts = Record<CountKey, number>;

interface Props {
  density: Density;
  intensity: Intensity;
  unreadCount: number;
  mobile?: boolean;
}

const CATEGORY_KEYS = Object.keys(CATEGORY_META) as NotificationCategory[];
const EMPTY_ITEMS: NotificationItemDto[] = [];

function isUnread(item: NotificationItemDto): boolean {
  return isNil(item.readAt);
}

function createEmptyCounts(): Counts {
  const counts = { all: 0, unread: 0 } as Counts;
  for (const category of CATEGORY_KEYS) {
    counts[category] = 0;
  }
  return counts;
}

function derivePopoverState(
  items: NotificationItemDto[],
  filter: Filter,
  unreadOnly: boolean,
): { counts: Counts; filtered: NotificationItemDto[] } {
  const counts = createEmptyCounts();
  const filtered: NotificationItemDto[] = [];

  for (const item of items) {
    const unread = isUnread(item);
    if (unread) counts.unread += 1;
    if (unreadOnly && !unread) continue;

    counts.all += 1;
    counts[item.category] += 1;

    if (filter === "all" || item.category === filter) {
      filtered.push(item);
    }
  }

  return { counts, filtered };
}

function UnreadToggle({
  active,
  count,
  onToggle,
}: {
  active: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-primary" : count > 0 ? "bg-primary/60" : "bg-muted-foreground/30",
        )}
      />
      {m.notifications_unread_count({ count })}
    </button>
  );
}

interface PopoverBodyProps {
  density: Density;
  intensity: Intensity;
  filter: Filter;
  unreadOnly: boolean;
  onFilterChange: (value: string) => void;
}

function PopoverBody({ density, intensity, filter, unreadOnly, onFilterChange }: PopoverBodyProps) {
  // Fetch unfiltered so chip counts reflect the full inbox window. Category +
  // unread filters apply client-side so switching one filter does not shrink
  // the others' counts.
  const { data } = usePopoverInbox();
  const items = (data?.items ?? EMPTY_ITEMS) as NotificationItemDto[];

  const { counts, filtered } = useMemo(
    () => derivePopoverState(items, filter, unreadOnly),
    [items, filter, unreadOnly],
  );

  const filterLabel = filter !== "all" ? categoryLabel(filter) : null;

  return (
    <>
      <div className="shrink-0 px-4 pb-2.5">
        <RadioGroup
          value={filter}
          onValueChange={onFilterChange}
          aria-label={m.notifications_filter_aria()}
          className="flex-nowrap overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent_100%)]"
        >
          <CategoryChip value="all" label={m.notifications_category_all()} count={counts.all} />
          {CATEGORY_KEYS.map((k) => (
            <CategoryChip
              key={k}
              value={k}
              category={k}
              label={categoryLabel(k)}
              count={counts[k]}
            />
          ))}
        </RadioGroup>
      </div>

      <div className="h-px shrink-0 bg-border" />

      <ScrollArea className="min-h-0 flex-1">
        <div role="list">
          {filtered.length === 0 ? (
            <PopoverEmpty filterLabel={filterLabel} />
          ) : (
            filtered.map((item) => (
              <PopoverRow key={item.id} item={item} density={density} intensity={intensity} />
            ))
          )}
        </div>
      </ScrollArea>
    </>
  );
}

function PopoverErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const onRetry = () => {
    void queryClient.resetQueries({ queryKey: notificationsKeys.popoverInbox({}) });
    reset();
  };

  return (
    <div className="min-h-0 flex-1 p-4">
      <ErrorState data-testid="notifications-popover-error" data-error-name={error.name}>
        <ErrorStateMedia />
        <ErrorStateContent>
          <ErrorStateTitle>{m.notifications_error_title()}</ErrorStateTitle>
          <ErrorStateDescription>{m.notifications_error_body()}</ErrorStateDescription>
        </ErrorStateContent>
        <ErrorStateActions>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RotateCcwIcon className="size-3.5" aria-hidden="true" />
            {m.notifications_error_retry()}
          </Button>
        </ErrorStateActions>
      </ErrorState>
    </div>
  );
}

// fallow-ignore-next-line complexity
export function BellPopoverShell({ density, intensity, unreadCount, mobile = false }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const markAllRead = useMarkAllRead();

  const onFilterChange = (v: string) => {
    startTransition(() => setFilter(v as Filter));
  };

  const onMarkAllRead = () => {
    markAllRead.mutate(filter !== "all" ? { category: filter } : {});
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 px-4",
          mobile ? "pb-2.5 pt-5" : "pb-2.5 pt-3.5",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("font-semibold text-foreground", mobile ? "text-lg" : "text-sm")}>
            {m.notifications_title()}
          </span>
          <UnreadToggle
            active={unreadOnly}
            count={unreadCount}
            onToggle={() => startTransition(() => setUnreadOnly((v) => !v))}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
          aria-label={m.notifications_mark_all_read()}
          title={m.notifications_mark_all_read()}
        >
          <CheckCheckIcon />
        </Button>
      </div>

      <ErrorBoundary
        fallback={({ error, reset }) => <PopoverErrorFallback error={error} reset={reset} />}
      >
        <Suspense fallback={<PopoverSkeleton />}>
          <PopoverBody
            density={density}
            intensity={intensity}
            filter={filter}
            unreadOnly={unreadOnly}
            onFilterChange={onFilterChange}
          />
        </Suspense>
      </ErrorBoundary>

      <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-muted-foreground"
          render={<a href="/settings/notifications" />}
        >
          <SettingsIcon className="size-3.5" />
          {m.notifications_settings_button()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          render={<Link to="/notifications" />}
        >
          {m.notifications_view_all()}
        </Button>
      </div>
    </div>
  );
}
