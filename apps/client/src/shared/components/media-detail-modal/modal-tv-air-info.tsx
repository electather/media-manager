import { Calendar } from "lucide-react";
import * as m from "@/paraglide/messages";
import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
};

export function ModalTVAirInfo({ item }: Props) {
  if (item.mediaType !== "tv" || !item.seriesStatus) return null;

  return (
    <div className="flex flex-wrap gap-2 px-6 sm:px-10">
      <SeriesStatusPill status={item.seriesStatus} />
      {item.seriesStatus === "ongoing" && item.nextAirDate ? (
        <NextAirDatePill date={item.nextAirDate} />
      ) : null}
    </div>
  );
}

function SeriesStatusPill({ status }: { status: "ongoing" | "finished" }) {
  const ongoing = status === "ongoing";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/70 px-3 py-2">
      <span
        className={`size-2 shrink-0 rounded-full ${ongoing ? "bg-green-500 shadow-[0_0_6px_theme(colors.green.500)]" : "bg-muted-foreground"}`}
        aria-hidden="true"
      />
      <div className="flex flex-col">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {m.home_detail_series_label()}
        </span>
        <span className="text-sm font-medium text-foreground">
          {ongoing ? m.home_detail_series_ongoing() : m.home_detail_series_finished()}
        </span>
      </div>
    </div>
  );
}

function NextAirDatePill({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/70 px-3 py-2">
      <Calendar aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
      <div className="flex flex-col">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {m.home_detail_next_air_date()}
        </span>
        <span className="text-sm font-medium text-foreground">{date}</span>
      </div>
    </div>
  );
}
