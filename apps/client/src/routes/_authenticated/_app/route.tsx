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
 *
 * Post-PR6 the home wire ships row stubs, not item arrays — the command
 * menu pool seeds from the hero slides only. A dedicated search endpoint
 * is the next step (tracked separately) for the broader pool the prototype
 * seeded from every row.
 */
function AppLayout() {
  const { data: feed } = useHomeFeed();

  const value = useMemo<CommandMenuMediaSource>(() => {
    const pool: CommandMenuMediaItem[] = [];
    const seen = new Set<string>();
    const push = (item: CommandMenuMediaItem | null | undefined) => {
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      pool.push(item);
    };
    feed?.hero?.slides.forEach((slide) => push(slide.item));
    return { pool, trending: [] };
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
