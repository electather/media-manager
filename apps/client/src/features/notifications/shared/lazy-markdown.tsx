import { Suspense, lazy } from "react";

// react-markdown pulls in the remark/micromark/mdast tree (~350 kB), and
// notification bodies are the only place we render markdown. Load it on demand
// so it stays out of the entry chunk.
const Markdown = lazy(() => import("react-markdown"));

/**
 * Renders a notification body as markdown. While the renderer chunk loads, the
 * raw text is shown so content appears immediately, then upgrades in place.
 */
export function LazyMarkdown({ children }: { children: string }) {
  return (
    <Suspense fallback={children}>
      <Markdown>{children}</Markdown>
    </Suspense>
  );
}
