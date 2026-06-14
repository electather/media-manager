/**
 * Warming-state placeholder for the fresh-install window. A brand-new install
 * composes an empty layout (no hero, no rows) until the discover-snapshot job
 * warms the catalog. Rather than render a blank page, the home feed shows this
 * friendly state; the layout query polls while empty (see
 * `homeLayoutQueryOptions`) so the feed fills in on its own. The refresh action
 * lets an impatient user invalidate the layout query manually.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";
import { m } from "@/paraglide/messages";
import { EmptyState } from "@/shared/components/empty-state";
import { Button } from "@/shared/ui/button";
import { homeKeys } from "../lib/query-keys";

export function HomeEmpty() {
  const queryClient = useQueryClient();
  return (
    <div className="mx-auto w-full max-w-md">
      <EmptyState
        icon={<Clapperboard />}
        title={m.home_empty_title()}
        description={m.home_empty_body()}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void queryClient.invalidateQueries({ queryKey: homeKeys.layout() })}
          >
            {m.home_empty_refresh()}
          </Button>
        }
      />
    </div>
  );
}
