import type { RowContentResponse } from "@ent-mcp/shared/home";
import { decode, type Cursor, type Page } from "../../media";
import { HttpError } from "../../diagnostics/http-errors";
import { ROW_PROVIDERS } from "../rows";
import { isRowSoftFailure } from "./row-soft-failure";
import type { RowContext, RowProvider } from "./types";

/**
 * Decode an incoming home-feed cursor against the row's pagination mode. The
 * home feed maps a bad/foreign/mode-mismatched cursor (`decode → null`) to
 * `HttpError 400` — preserving its existing contract (invariant V.CU1; the
 * codec itself never throws). An absent cursor is the first page, unless the
 * row pins its seed on the cursor (`requiresInitialCursor`), where a null
 * cursor is rejected.
 */
function decodeRowCursor(provider: RowProvider, cursor: string | null): Cursor | null {
  if (cursor === null) {
    if (provider.requiresInitialCursor) {
      throw new HttpError(400, "home.bad_input", "cursor_required");
    }
    return null;
  }
  const decoded = decode(cursor, provider.cursorMode);
  if (decoded === null) {
    throw new HttpError(400, "home.bad_input", "cursor_invalid");
  }
  return decoded;
}

/**
 * Runs a row's pipeline load, converting a soft plugin failure into a
 * `partial: true` empty page (the consumer degrades gracefully) while letting
 * a hard error bubble.
 */
async function loadRowSafely(
  ctx: RowContext,
  provider: RowProvider,
  cursor: Cursor | null,
): Promise<Page> {
  try {
    return await provider.load(ctx, cursor);
  } catch (err) {
    if (!isRowSoftFailure(err)) throw err;
    ctx.logger.warn(`[home:row] ${provider.rowId} load soft-failed`, err);
    return { items: [], cursor: null, partial: true };
  }
}

/**
 * Loads one row page, applying direct-access guards before running the row
 * through the shared media pipeline (`provider.load` → `media.listRows`), which
 * already projects the row items into the public wire shape.
 */
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
  const page = await loadRowSafely(ctx, provider, decodeRowCursor(provider, cursor));

  const out: RowContentResponse = { items: page.items, cursor: page.cursor };
  if (page.partial) out.partial = true;
  return out;
}
