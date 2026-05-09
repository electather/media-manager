import * as m from "@/paraglide/messages";
import type { LibraryMoodGroup } from "../lib/types";
import { MoodCluster } from "./mood-cluster";
import { SectionHead } from "./section-head";

interface MoodMosaicProps {
  groups: readonly LibraryMoodGroup[];
  onPeek: (id: string) => void;
}

export function MoodMosaic({ groups, onPeek }: MoodMosaicProps) {
  const live = groups.filter((g) => g.items.length > 0);
  if (live.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.library_mood_eyebrow()}
        title={m.library_mood_title()}
        accessory={
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground/70">
            {m.library_mood_auto_clustered({ count: String(live.length) })}
          </span>
        }
      />
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
