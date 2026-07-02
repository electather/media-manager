import * as m from "@/paraglide/messages";
import { ROW_COPY } from "./home-feed-config";
import type { MessageKey, RowData } from "./types";

export interface RowCopy {
  heading: string;
  eyebrow?: string;
  prevLabel: string;
  nextLabel: string;
}

/**
 * Resolves a row's header/eyebrow message keys into rendered copy plus the
 * prev/next aria labels. Per-row overrides (`row.headerKey`/`eyebrowKey`) win
 * over the `kind` defaults in `ROW_COPY` so two rows of the same kind stay
 * readable. The dynamic `m[key]` lookup is validated in DEV so a bad override
 * key fails loud at the row instead of rendering a broken string.
 */
// fallow-ignore-next-line complexity
export function resolveRowCopy(row: RowData): RowCopy {
  const copy = ROW_COPY[row.kind];
  const headerKey: MessageKey = row.headerKey ?? copy.headerKey;
  const headerFn = m[headerKey] as (params?: Record<string, string>) => string;
  if (import.meta.env.DEV && typeof headerFn !== "function") {
    throw new Error(`Row: unknown i18n key "${String(headerKey)}"`);
  }
  const heading = headerFn(row.seedTitle ? { seedTitle: row.seedTitle } : {});

  const eyebrowKey: MessageKey | undefined = row.eyebrowKey ?? copy.eyebrowKey;
  const eyebrowFn = eyebrowKey ? (m[eyebrowKey] as () => string) : null;
  const eyebrow = eyebrowFn?.();

  return {
    heading,
    eyebrow,
    prevLabel: m.home_row_prev_label({ row: heading }),
    nextLabel: m.home_row_next_label({ row: heading }),
  };
}
