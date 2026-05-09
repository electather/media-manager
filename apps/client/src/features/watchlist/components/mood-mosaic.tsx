import * as m from "@/paraglide/messages";
import type { MoodGroup } from "../lib/types";
import { MoodCluster } from "./mood-cluster";
import { SectionHead } from "./section-head";

interface MoodMosaicProps {
  moods: readonly MoodGroup[];
  onPeek: (id: string) => void;
}

export function MoodMosaic({ moods, onPeek }: MoodMosaicProps) {
  const live = moods.filter((g) => g.items.length > 0);
  if (live.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.watchlist_section_mood_eyebrow()}
        title={m.watchlist_section_mood_title()}
        accessory={
          <div className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground/70 uppercase">
            {m.watchlist_section_mood_accessory({ n: String(live.length) })}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {live.map((mood) => (
          <MoodCluster
            key={mood.id}
            mood={mood}
            onPeek={onPeek}
            onSeeAll={() => onPeek(mood.items[0]?.id ?? "")}
          />
        ))}
      </div>
    </section>
  );
}
