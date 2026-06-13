import type { ReactNode } from "react";
import type { LibraryLens } from "@nama/shared/library";
import { useLibraryContent } from "../../hooks/use-library-content";
import { LibraryEmpty } from "../library-empty";

type ItemLens = Exclude<LibraryLens, "collections">;
type LensContent = ReturnType<typeof useLibraryContent>;

/**
 * The guard every item-lens route shares: reads THIS lens's Suspense infinite
 * content, shows the empty state when nothing survives the active filters, and
 * otherwise hands the resolved content to the lens presenter. Keeps each
 * `*-lens-page` a one-liner so the empty-state wiring lives in exactly one
 * place. The `lens` is fixed per route, so the inner `useLibraryContent(lens)`
 * is one infinite query per mounted lens (skill rule 7) — collections has its
 * own page (group-first shape), so it never routes through here.
 */
export function LensPage({
  lens,
  render,
}: {
  lens: ItemLens;
  render: (content: LensContent) => ReactNode;
}) {
  const content = useLibraryContent(lens);
  if (content.isEmpty) return <LibraryEmpty onReset={content.resetFilters} />;
  return <>{render(content)}</>;
}
