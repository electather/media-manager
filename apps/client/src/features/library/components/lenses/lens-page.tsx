import type { ReactNode } from "react";
import { useLibraryContent } from "../../hooks/use-library-content";
import { LibraryEmpty } from "../library-empty";

type LensContent = ReturnType<typeof useLibraryContent>;

/**
 * The guard every lens route shares: reads the filtered library content, shows
 * the empty state when nothing survives the active filters, and otherwise hands
 * the resolved content to the lens. Keeps each `*-lens-page` a one-liner so the
 * empty-state wiring lives in exactly one place.
 */
export function LensPage({ render }: { render: (content: LensContent) => ReactNode }) {
  const content = useLibraryContent();
  if (content.isEmpty) return <LibraryEmpty onReset={content.resetFilters} />;
  return <>{render(content)}</>;
}
