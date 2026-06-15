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
import { watchlistKeys } from "../../../lib/query-keys";
import { WatchlistErrorFallback } from "../../watchlist-error-fallback";
import { MoodCluster } from "./mood-cluster";

const MAX_CLUSTERS = 3;
const SK_CLUSTER_PX = 420; // Cluster card skeleton height (poster 2/3 + head).

export function MoodMosaic() {
  const { data } = useMoods();
  const clusters = data.clusters.slice(0, MAX_CLUSTERS);
  if (clusters.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>
            {m.watchlist_section_eyebrow({ section: "mood" })}
          </SectionHeadEyebrow>
          <SectionHeadTitle>{m.watchlist_section_title({ section: "mood" })}</SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground/70">
            {m.watchlist_mood_auto_clustered({ count: String(clusters.length) })}
          </span>
        </SectionHeadActions>
      </SectionHead>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {clusters.map((c) => (
          // Each cluster gets its own error boundary so a single failed fetch
          // surfaces a retry affordance instead of silently collapsing the card.
          // The query key targets only this cluster's cache so retry is scoped.
          <ErrorBoundary
            key={c.moodId}
            fallback={({ error, reset }) => (
              <WatchlistErrorFallback
                error={error}
                resetErrorBoundary={reset}
                queryKey={watchlistKeys.moodItems(c.moodId)}
              />
            )}
          >
            <Suspense
              fallback={
                <Skeleton className="w-full rounded-2xl" style={{ height: SK_CLUSTER_PX }} />
              }
            >
              <MoodCluster moodId={c.moodId} count={c.count} />
            </Suspense>
          </ErrorBoundary>
        ))}
      </div>
    </section>
  );
}
