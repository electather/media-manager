import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/app/app-shell";
import { useHomeFeed } from "@/features/home";
import {
  CommandMenuMediaProvider,
  type CommandMenuMediaItem,
  type CommandMenuMediaSource,
} from "@/shared/components/command-menu-media-provider";

/**
 * Route layout for the authenticated app shell. Lives in the routes layer
 * (allowed to depend on features) so it can source the home feed for the
 * command menu without dragging that dependency into `app/`.
 */
function AppLayout() {
  const feed = useHomeFeed();

  const value = useMemo<CommandMenuMediaSource>(() => {
    const seen = new Set<string>();
    const pool: CommandMenuMediaItem[] = [];
    const push = (item: CommandMenuMediaItem | null | undefined) => {
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      pool.push(item);
    };

    push(feed.hero);
    feed.hero?.alternates.forEach(push);
    feed.rows.forEach((row) => row.items.forEach(push));

    const trending = feed.rows.find((row) => row.kind === "trendingNow")?.items ?? [];
    return { pool, trending };
  }, [feed]);

  return (
    <CommandMenuMediaProvider value={value}>
      <AppShell />
    </CommandMenuMediaProvider>
  );
}

export const Route = createFileRoute("/_authenticated/_app")({
  component: AppLayout,
});
