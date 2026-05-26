import type { RowContentResponse } from "@ent-mcp/shared/home";
import { HttpError } from "../../diagnostics/http-errors";
import { ROW_PROVIDERS } from "../rows";
import { enrichHomeItems } from "./media-enrichment";
import { isRowSoftFailure } from "./row-soft-failure";
import type { RowContext, RowPage } from "./types";

/**
 * Loads one row page, applying direct-access guards before media-owned
 * enrichment projects the row items into the public wire shape.
 */
// fallow-ignore-next-line complexity
export async function composeRowPage(
  ctx: RowContext,
  rowId: string,
  cursor: string | null,
): Promise<RowContentResponse> {
  const provider = ROW_PROVIDERS[rowId];
  if (!provider) {
    throw new HttpError(404, "home.row_unavailable", `unknown rowId: ${rowId}`);
  }
  const eligible = await provider.eligibility(ctx).catch(() => false);
  if (!eligible) {
    throw new HttpError(404, "home.row_unavailable", `row ineligible: ${rowId}`);
  }
  if (provider.requiresInitialCursor && cursor === null) {
    throw new HttpError(400, "home.bad_input", "cursor_required");
  }

  let page: RowPage;
  try {
    page = await provider.fetchPage(ctx, cursor);
  } catch (err) {
    if (!isRowSoftFailure(err)) throw err;
    ctx.logger.warn(`[home:row] ${rowId} fetchPage soft-failed`, err);
    page = { items: [], cursor: null, partial: true };
  }

  const enriched = await enrichHomeItems(page.items, ctx, { rowId });
  const out: RowContentResponse = { items: enriched.items, cursor: page.cursor };
  if (page.partial || enriched.partial) out.partial = true;
  return out;
}
