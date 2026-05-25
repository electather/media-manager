import type { ReactNode } from "react";
import { useCounts } from "../hooks/use-counts";
import { WatchlistHeader } from "./watchlist-header";
import { WatchlistPeekModal } from "./watchlist-peek-modal";

interface WatchlistLayoutProps {
  children: ReactNode;
}

/**
 * Shared layout for the `/watchlist/*` route family. Renders the page
 * header + container shell + peek modal once; each leaf route mounts its
 * own content inside `<Outlet />`. The header reads counts via
 * `useSuspenseQuery`; the parent route loader prefetches them so the
 * Suspense boundary resolves on first paint.
 */
export function WatchlistLayout({ children }: WatchlistLayoutProps) {
  const { data: counts } = useCounts();
  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8">
      <WatchlistHeader counts={counts} />
      <div className="pb-32">{children}</div>
      <WatchlistPeekModal />
    </main>
  );
}
