import { Suspense } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { Skeleton } from "@/shared/ui/skeleton";
import { useMoods } from "../../../hooks/use-moods";
import { MoodCluster } from "./mood-cluster";

const MAX_CLUSTERS = 3;

export function MoodMosaic() {
  const { data } = useMoods();
  const clusters = data.clusters.slice(0, MAX_CLUSTERS);
  if (clusters.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.watchlist_mood_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>{m.watchlist_mood_title()}</SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground/70">
            {m.watchlist_mood_auto_clustered({ count: String(clusters.length) })}
          </span>
        </SectionHeadActions>
      </SectionHead>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {clusters.map((c) => (
          <ErrorBoundary key={c.moodId} fallback={() => null}>
            <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-2xl" />}>
              <MoodCluster moodId={c.moodId} count={c.count} />
            </Suspense>
          </ErrorBoundary>
        ))}
      </div>
    </section>
  );
}
