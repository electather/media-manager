import { Suspense, useState } from "react";
import { PlusIcon } from "lucide-react";
import type { PluginSummary } from "@nama/shared/connections";
import { ConnectionModal } from "@/features/connections";
import { useAvailablePlugins } from "@/features/settings-connections";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { NameGlyph } from "@/shared/components/name-glyph";
import { Skeleton } from "@/shared/ui/skeleton";
import { TmdbKeyForm } from "./tmdb-key-form";

/**
 * The connect-services step has two regions: a required TMDB metadata key and an
 * optional list of personal connections. Completeness is derived server-side
 * (the TMDB shared credential), so this component never gates Finish itself.
 */
export function ConnectServicesStep() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">
            {m.onboarding_connect_required_title()}
          </h2>
          <p className="text-sm text-muted-foreground">
            {m.onboarding_connect_required_description()}
          </p>
        </div>
        <TmdbKeyForm />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">
            {m.onboarding_connect_optional_title()}
          </h2>
          <p className="text-sm text-muted-foreground">
            {m.onboarding_connect_optional_description()}
          </p>
        </div>
        <Suspense fallback={<OptionalConnectionsSkeleton />}>
          <OptionalConnections />
        </Suspense>
      </section>
    </div>
  );
}

function OptionalConnectionsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

function OptionalConnections() {
  const available = useAvailablePlugins();
  const plugins = available.data;
  const [target, setTarget] = useState<PluginSummary | null>(null);

  if (plugins.length === 0) {
    return <p className="text-sm text-muted-foreground">{m.onboarding_connect_optional_empty()}</p>;
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {plugins.map((plugin) => (
          <div
            key={plugin.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center gap-3">
              <NameGlyph name={plugin.name} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{plugin.name}</p>
              </div>
            </div>
            <p className="line-clamp-2 min-h-9 text-xs text-muted-foreground">
              {plugin.description}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setTarget(plugin)}
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {m.onboarding_connect_optional_connect()}
            </Button>
          </div>
        ))}
      </div>

      <ConnectionModal
        open={!!target}
        plugin={target}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        onSuccess={() => {
          void available.refetch();
        }}
      />
    </>
  );
}
