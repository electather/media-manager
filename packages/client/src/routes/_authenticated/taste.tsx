import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import {
  formatLanguage,
  formatRuntime,
  parsePerson,
  tagCloudFontSize,
  topN,
} from "@/lib/taste-display";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/taste")({
  component: TastePage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface PreferenceProfile {
  userId: string;
  mediaType: "movie" | "tv" | "combined";
  features: {
    genres: Record<string, number>;
    keywords: Record<string, number>;
    people: Record<string, number>;
    decades: Record<string, number>;
    runtimes: Record<string, number>;
    languages: Record<string, number>;
  };
  sampleSize: number;
  confidence: "low" | "medium" | "high";
  lastRebuiltAt: number;
  lastUpdatedAt: number;
  embedding?: number[];
}

interface RebuildStatus {
  status: "idle" | "running" | "succeeded" | "failed";
  lastRunAt?: number;
}

type MediaTab = "movie" | "tv";

const POLL_INTERVAL_MS = 2000;

// ─── Queries ──────────────────────────────────────────────────────────────────

function useProfileQuery(mediaType: MediaTab) {
  return useQuery({
    queryKey: ["preference", "profile", mediaType],
    queryFn: async (): Promise<PreferenceProfile | null> => {
      const res = await api.preferences.profile.$get({ query: { mediaType } });
      if (!res.ok) throw new Error("Failed to load taste profile.");
      const body = (await res.json()) as { profile: PreferenceProfile | null };
      return body.profile;
    },
    staleTime: 60_000,
  });
}

function useRebuildStatusQuery() {
  return useQuery({
    queryKey: ["preference", "rebuildStatus"],
    queryFn: async (): Promise<RebuildStatus> => {
      const res = await api.preferences.rebuild.status.$get();
      if (!res.ok) throw new Error("Failed to load rebuild status.");
      return (await res.json()) as RebuildStatus;
    },
    refetchInterval: (query) => (query.state.data?.status === "running" ? POLL_INTERVAL_MS : false),
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function TastePage() {
  const [activeTab, setActiveTab] = useState<MediaTab>("movie");
  const qc = useQueryClient();

  const movieQuery = useProfileQuery("movie");
  const tvQuery = useProfileQuery("tv");
  const rebuildStatusQuery = useRebuildStatusQuery();

  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = rebuildStatusQuery.data?.status;
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (prev === "running") {
      if (status === "succeeded") {
        void qc.invalidateQueries({ queryKey: ["preference", "profile", "movie"] });
        void qc.invalidateQueries({ queryKey: ["preference", "profile", "tv"] });
        toast.success("Taste profile updated.");
      } else if (status === "failed") {
        toast.error("Rebuild failed. Please try again.");
      }
    }
  }, [rebuildStatusQuery.data?.status, qc]);

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      const res = await api.preferences.rebuild.$post();
      if (!res.ok) throw new Error("Failed to trigger rebuild.");
      return await res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["preference", "rebuildStatus"] });
    },
    onError: () => {
      toast.error("Rebuild failed. Please try again.");
    },
  });

  const isRebuilding = rebuildStatusQuery.data?.status === "running" || rebuildMutation.isPending;

  return (
    <div className="flex flex-col gap-8 px-4 py-4 md:py-6 lg:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Your taste profile</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          What the recommendation engine has learned about you.
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MediaTab)}>
        <TabsList>
          <TabsTrigger value="movie">Movies</TabsTrigger>
          <TabsTrigger value="tv">TV</TabsTrigger>
        </TabsList>

        {(["movie", "tv"] as const).map((tab) => {
          const tabQuery = tab === "movie" ? movieQuery : tvQuery;
          const isTabLoading = tabQuery.isLoading || rebuildStatusQuery.isLoading;
          const profile = tabQuery.data;

          return (
            <TabsContent key={tab} value={tab} className="flex flex-col gap-6">
              {isTabLoading ? (
                <LoadingSkeleton />
              ) : profile === null ? (
                <EmptyState
                  mediaType={tab}
                  isRebuilding={isRebuilding}
                  onRebuild={() => rebuildMutation.mutate()}
                />
              ) : profile === undefined ? (
                <LoadingSkeleton />
              ) : (
                <>
                  <StatusStrip
                    profile={profile}
                    isRebuilding={isRebuilding}
                    onRebuild={() => rebuildMutation.mutate()}
                  />
                  {profile.confidence === "low" && (
                    <ThinSignalAlert mediaType={tab} sampleSize={profile.sampleSize} />
                  )}
                  <FeatureGrid profile={profile} />
                </>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

// ─── Status strip ─────────────────────────────────────────────────────────────

function StatusStrip({
  profile,
  isRebuilding,
  onRebuild,
}: {
  profile: PreferenceProfile;
  isRebuilding: boolean;
  onRebuild: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md bg-secondary px-4 py-3">
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <ConfidenceBadge confidence={profile.confidence} />
        <span className="text-xs text-muted-foreground">{profile.sampleSize} items</span>
        <LastRebuiltText lastRebuiltAt={profile.lastRebuiltAt} isRebuilding={isRebuilding} />
      </div>
      <RebuildButton isRebuilding={isRebuilding} onRebuild={onRebuild} />
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: "low" | "medium" | "high" }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        confidence === "high" &&
          "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
        confidence === "medium" && "border-transparent bg-secondary",
        confidence === "low" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      <span className="sr-only">Confidence: </span>
      {confidence === "high" ? "High" : confidence === "medium" ? "Medium" : "Low"}
    </Badge>
  );
}

function LastRebuiltText({
  lastRebuiltAt,
  isRebuilding,
}: {
  lastRebuiltAt: number;
  isRebuilding: boolean;
}) {
  if (isRebuilding) {
    return <span className="text-xs text-muted-foreground">Rebuild in progress</span>;
  }
  if (!lastRebuiltAt) {
    return <span className="text-xs text-muted-foreground">Never rebuilt</span>;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="cursor-default text-xs text-muted-foreground">
          Last rebuilt {formatRelative(lastRebuiltAt)}
        </TooltipTrigger>
        <TooltipContent>{formatTimestamp(lastRebuiltAt)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RebuildButton({
  isRebuilding,
  onRebuild,
}: {
  isRebuilding: boolean;
  onRebuild: () => void;
}) {
  return (
    <Button
      onClick={onRebuild}
      disabled={isRebuilding}
      aria-busy={isRebuilding}
      className="w-full sm:w-auto"
    >
      {isRebuilding ? (
        <>
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          Rebuilding…
          <span className="sr-only">Rebuilding taste profile</span>
        </>
      ) : (
        <>
          <RefreshCwIcon aria-hidden="true" />
          Rebuild now
        </>
      )}
    </Button>
  );
}

// ─── Feature grid ─────────────────────────────────────────────────────────────

function FeatureGrid({ profile }: { profile: PreferenceProfile }) {
  const { features } = profile;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <TagCloudCard title="Genres" features={features.genres} />
      <TagCloudCard title="Keywords" features={features.keywords} />
      <RankedBarCard
        title="People"
        features={features.people}
        limit={8}
        formatLabel={(key) => <PeopleLabel raw={key} />}
        labelFlex
      />
      <RankedBarCard
        title="Decades"
        features={features.decades}
        limit={10}
        formatLabel={(key) => key}
        minLabelWidth="48px"
      />
      <RankedBarCard
        title="Runtime"
        features={features.runtimes}
        limit={4}
        formatLabel={formatRuntime}
        minLabelWidth="96px"
      />
      <RankedBarCard
        title="Languages"
        features={features.languages}
        limit={8}
        formatLabel={formatLanguage}
        minLabelWidth="72px"
      />
    </div>
  );
}

// ─── Tag cloud card ───────────────────────────────────────────────────────────

function TagCloudCard({ title, features }: { title: string; features: Record<string, number> }) {
  const entries = topN(features, 10);

  if (entries.length === 0) {
    return <EmptyFeatureCard title={title} />;
  }

  const weights = entries.map(([, w]) => w);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const midIdx = Math.ceil(entries.length / 2);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div role="list" className="flex flex-wrap" style={{ gap: "6px 14px" }}>
          {entries.map(([label, weight], idx) => {
            const fontSize = tagCloudFontSize(weight, minW, maxW);
            const isTopHalf = idx < midIdx;
            const isBold = idx < 3;
            return (
              <span
                key={label}
                role="listitem"
                style={{ fontSize: `${fontSize}px`, fontWeight: isBold ? 500 : 400 }}
                className={isTopHalf ? "text-foreground" : "text-muted-foreground"}
              >
                {label}
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Ranked bar card ──────────────────────────────────────────────────────────

function RankedBarCard({
  title,
  features,
  limit,
  formatLabel,
  labelFlex = false,
  minLabelWidth,
}: {
  title: string;
  features: Record<string, number>;
  limit: number;
  formatLabel: (key: string) => React.ReactNode;
  labelFlex?: boolean;
  minLabelWidth?: string;
}) {
  const entries = topN(features, limit);

  if (entries.length === 0) {
    return <EmptyFeatureCard title={title} />;
  }

  const maxWeight = entries[0]![1];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-1">
          {entries.map(([key, weight]) => {
            const pct = maxWeight > 0 ? Math.round((weight / maxWeight) * 100) : 0;
            return (
              <div key={key} className="flex h-6 items-center gap-3">
                <dt
                  className={cn(
                    "text-[13px] text-foreground",
                    labelFlex ? "min-w-0 flex-1 truncate" : "shrink-0",
                  )}
                  style={!labelFlex && minLabelWidth ? { minWidth: minLabelWidth } : undefined}
                >
                  {formatLabel(key)}
                </dt>
                <dd className={cn("flex items-center", labelFlex ? "w-24 shrink-0" : "flex-1")}>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${key}, ${pct}% of top`}
                    className="relative h-[5px] w-full rounded-full bg-secondary"
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-foreground"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}

// ─── People label ─────────────────────────────────────────────────────────────

function PeopleLabel({ raw }: { raw: string }) {
  const { role, name } = parsePerson(raw);
  if (!role) {
    return <span>{name}</span>;
  }
  return (
    <span>
      <span className="text-muted-foreground">{role}</span>
      <span className="text-muted-foreground"> · </span>
      {name}
    </span>
  );
}

// ─── Empty feature card ───────────────────────────────────────────────────────

function EmptyFeatureCard({ title }: { title: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Not enough signal yet.</p>
      </CardContent>
    </Card>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  mediaType,
  isRebuilding,
  onRebuild,
}: {
  mediaType: MediaTab;
  isRebuilding: boolean;
  onRebuild: () => void;
}) {
  const label = mediaType === "movie" ? "movie" : "TV";
  return (
    <div className="flex items-center justify-center py-16">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <h3 className="text-lg font-semibold tracking-tight">No {label} taste profile yet.</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Rate things, note what you liked or disliked, or add items to your watchlist — the
            recommendation engine picks up signal from everything you do. Try asking the assistant
            to rate a movie.
          </p>
          <RebuildButton isRebuilding={isRebuilding} onRebuild={onRebuild} />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Thin-signal alert ────────────────────────────────────────────────────────

function ThinSignalAlert({ mediaType, sampleSize }: { mediaType: MediaTab; sampleSize: number }) {
  const label = mediaType === "movie" ? "movie" : "TV";
  const itemLabel = sampleSize === 1 ? "item" : "items";
  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>Still learning your {label} taste.</AlertTitle>
      <AlertDescription>
        Your {sampleSize} {itemLabel} aren&rsquo;t enough for us to score confidently on their own.
        Until there&rsquo;s more signal, we use your overall taste across both movies and TV.
      </AlertDescription>
    </Alert>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 rounded-md bg-secondary px-4 py-3">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="ml-auto h-8 w-28" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(ts: number): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}
