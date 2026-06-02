import type { ReactNode } from "react";
import { WatchlistHeader } from "./watchlist-header";
import { WatchlistPeekModal } from "./watchlist-peek-modal";

interface WatchlistLayoutProps {
  children: ReactNode;
}

/**
 * Shared layout for the `/watchlist/*` route family. Renders the page
 * header + container shell + peek modal once; each leaf route mounts its
 * own content inside `<Outlet />`.
 */
export function WatchlistLayout({ children }: WatchlistLayoutProps) {
  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8">
      <WatchlistHeader />
      <div className="pb-32">{children}</div>
      <WatchlistPeekModal />
    </main>
  );
}
