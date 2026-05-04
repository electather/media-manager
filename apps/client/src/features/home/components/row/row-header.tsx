import * as m from "@/paraglide/messages";
import { ROW_COPY } from "../../lib/home-feed-config";
import type { RowData } from "../../lib/types";

interface RowHeaderProps {
  row: RowData;
}

/** Renders the heading and optional subtitle for a row, plus a partial-results warning. */
export function RowHeader({ row }: RowHeaderProps) {
  const copy = ROW_COPY[row.kind];
  // The header key always corresponds to a parameterised message function; call with seedTitle if present.
  const headerFn = m[copy.headerKey] as (params?: Record<string, string>) => string;
  const heading = headerFn(row.seedTitle ? { seedTitle: row.seedTitle } : {});
  const subtitleFn = copy.subtitleKey ? (m[copy.subtitleKey] as () => string) : null;
  const subtitle = subtitleFn ? subtitleFn() : null;

  return (
    <div className="mb-3 flex items-center gap-2">
      <div>
        <h2 className="text-base font-semibold text-foreground">{heading}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {row.partial && (
        <span
          className="text-xs text-muted-foreground"
          title={m.home_row_partial_warning()}
          aria-label={m.home_row_partial_warning()}
          data-testid="partial-warning"
        >
          {m.home_row_partial_warning()}
        </span>
      )}
    </div>
  );
}
