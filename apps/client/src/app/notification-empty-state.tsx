import { m } from "@/paraglide/messages";

interface Props {
  filterLabel?: string | null;
}

export function NotificationEmptyState({ filterLabel }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3.5 px-6 py-10 text-center">
      <svg width="120" height="84" viewBox="0 0 120 84" fill="none" aria-hidden="true">
        <rect x="14" y="22" width="92" height="50" rx="10" className="fill-muted stroke-border" />
        <rect
          x="26"
          y="34"
          width="50"
          height="3"
          rx="1.5"
          className="fill-border"
          fillOpacity="0.7"
        />
        <rect
          x="26"
          y="44"
          width="68"
          height="3"
          rx="1.5"
          className="fill-border"
          fillOpacity="0.5"
        />
        <rect
          x="26"
          y="54"
          width="40"
          height="3"
          rx="1.5"
          className="fill-border"
          fillOpacity="0.35"
        />
        <circle
          cx="60"
          cy="20"
          r="14"
          className="stroke-primary"
          strokeOpacity="0.18"
          strokeWidth="1"
        />
        <circle
          cx="60"
          cy="20"
          r="9"
          className="stroke-primary"
          strokeOpacity="0.32"
          strokeWidth="1"
        />
        <circle cx="60" cy="20" r="4" className="fill-primary" fillOpacity="0.85" />
      </svg>
      <div>
        <p className="text-sm font-medium text-foreground">
          {filterLabel
            ? m.notifications_empty_filter_title({ label: filterLabel })
            : m.notifications_empty_caught_up_title()}
        </p>
        <p className="mx-auto mt-1 max-w-60 text-xs text-muted-foreground">
          {filterLabel
            ? m.notifications_empty_filter_body()
            : m.notifications_empty_caught_up_body()}
        </p>
      </div>
    </div>
  );
}
