import * as m from "@/paraglide/messages";

type Props = {
  percent: number;
};

export function TopZoneHeroProgress({ percent }: Props) {
  return (
    <div className="flex w-full max-w-md flex-col gap-1.5">
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-foreground/15"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-progress-watched" style={{ width: `${percent}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">
        {m.home_hero_progress_watched({ percent: String(percent) })}
      </div>
    </div>
  );
}
