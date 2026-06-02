import { Suspense, type ReactNode } from "react";
import { LibraryContentSkeleton } from "./library-content-skeleton";
import { LibraryHeader } from "./library-header";

interface LibraryLayoutProps {
  children: ReactNode;
}

/**
 * Shared shell for the `/library/*` route family. The header (lens tabs, filter
 * popover) renders once here; each lens route mounts its content inside
 * `<Outlet />`. The header reads the facet totals via a non-blocking `useQuery`
 * (the layout loader warms them) so a slow/failing facets read never suspends
 * the shell. The inner `<Suspense>` covers only the swappable content area,
 * keeping the header in place while a lens's suspense read revalidates (skill
 * rule 5).
 */
export function LibraryLayout({ children }: LibraryLayoutProps) {
  return (
    <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-8 px-4 pb-32 sm:px-6 lg:px-8">
      <LibraryHeader />
      <Suspense fallback={<LibraryContentSkeleton />}>{children}</Suspense>
    </div>
  );
}
