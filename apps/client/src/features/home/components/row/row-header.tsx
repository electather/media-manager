import * as m from "@/paraglide/messages";
import { ROW_COPY } from "../../lib/home-feed-config";
import type { MessageKey, RowData } from "../../lib/types";

interface RowHeaderProps {
  row: RowData;
}

/**
 * Heading + optional subtitle. Counter and partial-warning chips owned the
 * row's full item list in the mock era; with the row hook driving items
 * inside the scroller they would re-render this component on every fetch.
 * The orchestrator's `partial` flag still surfaces on the wire — wire it
 * back here once a UX treatment lands that doesn't churn the header.
 */
export function RowHeader({ row }: RowHeaderProps) {
  const copy = ROW_COPY[row.kind];
  const headerKey: MessageKey = row.headerKey ?? copy.headerKey;
  const headerFn = m[headerKey] as (params?: Record<string, string>) => string;
  if (import.meta.env.DEV && typeof headerFn !== "function") {
    throw new Error(`RowHeader: unknown i18n key "${String(headerKey)}"`);
  }
  const heading = headerFn(row.seedTitle ? { seedTitle: row.seedTitle } : {});
  const subtitleKey: MessageKey | undefined = row.subtitleKey ?? copy.subtitleKey;
  const subtitleFn = subtitleKey ? (m[subtitleKey] as () => string) : null;
  const subtitle = subtitleFn ? subtitleFn() : null;

  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex flex-col">
        <h2 className="text-base font-semibold text-foreground">{heading}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}
