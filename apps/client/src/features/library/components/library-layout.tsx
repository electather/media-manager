import { Suspense, type ReactNode } from "react";
import { LibraryContentSkeleton } from "./library-content-skeleton";
import { LibraryHeader } from "./library-header";

interface LibraryLayoutProps {
  children: ReactNode;
}

/**
 * Shared shell for the `/library/*` route family. The header (lens tabs, filter
 * popover) renders once here; each lens route mounts its grouped
 * content inside `<Outlet />`. The header reads the library payload via
 * `useSuspenseQuery` and the parent route loader prefetches it, so it paints on
 * first mount. The inner `<Suspense>` covers only the swappable content area,
 * keeping the header in place while a lens revalidates (skill rule 5).
 */
export function LibraryLayout({ children }: LibraryLayoutProps) {
  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-8 px-4 pb-32 sm:px-6 lg:px-8">
      <LibraryHeader />
      <Suspense fallback={<LibraryContentSkeleton />}>{children}</Suspense>
    </div>
  );
}
