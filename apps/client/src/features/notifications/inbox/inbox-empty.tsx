import { m } from "@/paraglide/messages";

export function InboxEmpty({ filterLabel }: { filterLabel?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-8 py-20 text-center">
      <p className="text-base font-medium text-foreground">
        {filterLabel
          ? m.notifications_empty_filter_title({ label: filterLabel })
          : m.notifications_empty_caught_up_title()}
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        {filterLabel ? m.notifications_empty_filter_body() : m.notifications_empty_caught_up_body()}
      </p>
    </div>
  );
}
