import { Server, Star, Tv } from "lucide-react";
import type { ReactNode } from "react";
import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "@/features/home/lib/types";

type Props = {
  item: HomeMediaItem;
};

export function DetailFactsSidebar({ item }: Props) {
  const hasScores =
    item.rating !== undefined || item.audienceScore !== undefined || item.criticScore !== undefined;

  return (
    <aside className="sticky top-37 flex flex-col gap-6">
      {hasScores ? <ScoresCard item={item} /> : null}
      <FactsCard item={item} />
      <SourcesCard item={item} />
    </aside>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

function ScoresCard({ item }: { item: HomeMediaItem }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <SectionLabel>{m.media_detail_scores()}</SectionLabel>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {item.rating !== undefined ? (
          <div className="col-span-2 rounded-lg bg-muted p-3">
            <SectionLabel>{m.media_detail_rating()}</SectionLabel>
            <div className="mt-1 flex items-baseline gap-1.5">
              <Star aria-hidden="true" className="size-4 fill-primary text-primary" />
              <span className="text-2xl font-semibold text-foreground">
                {item.rating.toFixed(1)}
              </span>
              {item.votes ? (
                <span className="text-xs text-muted-foreground">
                  · {(item.votes / 1000).toFixed(1)}k {m.media_detail_votes()}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        {item.audienceScore !== undefined ? (
          <div className="rounded-lg bg-muted p-3">
            <SectionLabel>{m.media_detail_audience()}</SectionLabel>
            <div className="mt-1 text-lg font-semibold">{item.audienceScore}%</div>
          </div>
        ) : null}
        {item.criticScore !== undefined ? (
          <div className="rounded-lg bg-muted p-3">
            <SectionLabel>{m.media_detail_critics()}</SectionLabel>
            <div className="mt-1 text-lg font-semibold">{item.criticScore}%</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-baseline gap-3 border-b border-border py-2.5 last:border-b-0">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-sm text-foreground/80 text-pretty">{children}</div>
    </div>
  );
}

function FactsCard({ item }: { item: HomeMediaItem }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 pb-2 pt-1">
      {item.director ? <FactRow label={m.home_detail_director()}>{item.director}</FactRow> : null}
      {item.cast && item.cast.length > 0 ? (
        <FactRow label={m.home_detail_cast()}>{item.cast.join(", ")}</FactRow>
      ) : null}
      {item.year !== undefined ? (
        <FactRow label={m.media_detail_released()}>{item.year}</FactRow>
      ) : null}
      {item.runtime ? <FactRow label={m.media_detail_runtime()}>{item.runtime}</FactRow> : null}
      {item.ageRating ? <FactRow label={m.media_detail_rated()}>{item.ageRating}</FactRow> : null}
      {item.genres && item.genres.length > 0 ? (
        <FactRow label={m.media_detail_genres()}>{item.genres.join(", ")}</FactRow>
      ) : null}
      {item.mediaType === "tv" && item.seriesStatus ? (
        <FactRow label={m.home_detail_series_label()}>
          <SeriesStatusInline status={item.seriesStatus} />
        </FactRow>
      ) : null}
      {item.mediaType === "tv" && item.seriesStatus === "ongoing" && item.nextAirDate ? (
        <FactRow label={m.home_detail_next_air_date()}>
          <span className="text-primary">{item.nextAirDate}</span>
        </FactRow>
      ) : null}
      {item.tags && item.tags.length > 0 ? (
        <FactRow label={m.media_detail_format()}>
          <span className="inline-flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.02em] text-foreground/80"
              >
                {tag}
              </span>
            ))}
          </span>
        </FactRow>
      ) : null}
    </div>
  );
}

function SeriesStatusInline({ status }: { status: "ongoing" | "finished" }) {
  const ongoing = status === "ongoing";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={
          ongoing
            ? "size-1.5 rounded-full bg-success shadow-[0_0_6px_var(--success)]"
            : "size-1.5 rounded-full bg-muted-foreground"
        }
      />
      {ongoing ? m.home_detail_series_ongoing() : m.home_detail_series_finished()}
    </span>
  );
}

function SourcesCard({ item }: { item: HomeMediaItem }) {
  const servers = item.availability?.servers ?? [];
  if (servers.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{m.media_detail_available_on()}</SectionLabel>
        <span className="text-[11px] text-muted-foreground/80">
          {m.media_detail_sources_count({ n: String(servers.length) })}
        </span>
      </div>
      <ul className="mt-2.5 flex flex-col gap-1.5 list-none p-0">
        {servers.map((server) => (
          <li key={server.id} className="flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-background/60 text-foreground/80">
              {server.id === "plex" ? (
                <Tv aria-hidden="true" className="size-3.5" />
              ) : (
                <Server aria-hidden="true" className="size-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{server.label}</div>
            </div>
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-success shadow-[0_0_6px_var(--success)]"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
