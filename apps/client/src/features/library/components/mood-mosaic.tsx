import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import type { LibraryMoodGroup } from "../lib/types";
import { MoodCluster } from "./mood-cluster";

interface MoodMosaicProps {
  groups: readonly LibraryMoodGroup[];
  onPeek: (id: string) => void;
}

export function MoodMosaic({ groups, onPeek }: MoodMosaicProps) {
  const live = groups.filter((g) => g.items.length > 0);
  if (live.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.library_mood_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>{m.library_mood_title()}</SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground/70">
            {m.library_mood_auto_clustered({ count: String(live.length) })}
          </span>
        </SectionHeadActions>
      </SectionHead>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {live.map((g) => (
          <MoodCluster
            key={g.mood.id}
            mood={g.mood}
            items={g.items}
            onPeek={onPeek}
            onSeeAll={() => g.items[0] && onPeek(g.items[0].id)}
          />
        ))}
      </div>
    </section>
  );
}
