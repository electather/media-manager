import type { ReactNode } from "react";

/**
 * Strips the `px-6 sm:px-10` gutter that the shared `Modal*` components apply
 * for the modal's narrower surface, so they slot cleanly into the page's own
 * gridded gutter without nested padding.
 */
export function UnpaddedModalSlot({ children }: { children: ReactNode }) {
  return (
    <div className="[&>div]:px-0! [&>section]:px-0! [&>div]:sm:px-0! [&>section]:sm:px-0!">
      {children}
    </div>
  );
}
