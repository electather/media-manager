import { ChevronRight, Film, Sparkles, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { recentTimeLabel } from "../lib/format";
import { LIBRARY_ITEM_INDEX, LIBRARY_RECENT_LOG } from "../lib/mock-data";
import type { LibraryItem, RecentLogEntry } from "../lib/types";

interface RecentlyAddedProps {
  onPeek: (id: string) => void;
}

interface ResolvedEntry {
  entry: RecentLogEntry;
  item: LibraryItem;
}

function resolveLog(): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  for (const entry of LIBRARY_RECENT_LOG) {
    const item = LIBRARY_ITEM_INDEX.get(entry.itemId);
    if (item) out.push({ entry, item });
  }
  return out;
}

export function RecentlyAdded({ onPeek }: RecentlyAddedProps) {
  const log = resolveLog();
  if (log.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.library_recent_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.library_recent_title()}
            <SectionHeadCount value={log.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>
      <ul className="m-0 overflow-hidden rounded-2xl border border-border bg-card p-0">
        {log.map((row, idx) => (
          <RecentRow
            key={`${row.entry.itemId}-${idx}`}
            row={row}
            isFirst={idx === 0}
            onPeek={onPeek}
          />
        ))}
      </ul>
    </section>
  );
}

// fallow-ignore-next-line complexity
function RecentRow({
  row,
  isFirst,
  onPeek,
}: {
  row: ResolvedEntry;
  isFirst: boolean;
  onPeek: (id: string) => void;
}) {
  const { entry, item } = row;
  const Icon = item.mediaType === "movie" ? Film : Tv;
  const kindLabel = item.mediaType === "movie" ? m.library_kind_movie() : m.library_kind_tv();
  const src = item.backdrop ?? item.poster;
  const sourceFn = m[entry.sourceKey];
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => onPeek(entry.itemId)}
        className={`grid w-full items-center gap-4 px-5 py-3.5 text-start transition-colors hover:bg-accent ${
          isFirst ? "" : "border-t border-border"
        }`}
        style={{ gridTemplateColumns: "110px 80px 1fr auto auto" }}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
          {recentTimeLabel(entry)}
        </span>
        <span className="relative h-[45px] w-20 overflow-hidden rounded-md bg-muted max-sm:hidden">
          {src ? (
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">{item.title}</span>
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon aria-hidden="true" className="size-3" />
            <span>{kindLabel}</span>
            {item.year ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.year}</span>
              </>
            ) : null}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] tracking-[0.03em] text-accent-foreground max-sm:hidden">
          <Sparkles aria-hidden="true" className="size-3" />
          {sourceFn()}
        </span>
        <span className="text-muted-foreground/70 max-sm:hidden">
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      </button>
    </li>
  );
}
