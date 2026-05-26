import type { HomeLayoutResponse, HomeRowStub, LayoutHero } from "@ent-mcp/shared/home";
import { AllPluginsFailedError, PluginCallError } from "../../media";
import { ROW_ORDER, ROW_PROVIDERS } from "../rows";
import { pickHero } from "./hero";
import { isRowSoftFailure } from "./row-soft-failure";
import type { RowContext } from "./types";

interface RowPreview {
  rowId: string;
  initialCursor: string | null;
  /** False when the row produced zero items on a fully successful fetch. */
  include: boolean;
}

export async function composeLayoutLive(ctx: RowContext): Promise<HomeLayoutResponse> {
  const [eligibleSet, hero] = await Promise.all([resolveEligibility(ctx), resolveHero(ctx)]);
  const previews = await Promise.all(
    ROW_ORDER.filter((rowId) => eligibleSet.has(rowId)).map((rowId) => previewRow(ctx, rowId)),
  );
  const previewByRow = new Map(previews.map((preview) => [preview.rowId, preview] as const));
  const rows = ROW_ORDER.flatMap((rowId) => {
    const preview = previewByRow.get(rowId);
    return preview?.include ? [buildRowStub(rowId, preview)] : [];
  });
  return { hero, rows, generatedAt: Date.now() };
}

async function resolveEligibility(ctx: RowContext): Promise<Set<string>> {
  const results = await Promise.all(
    ROW_ORDER.map(async (rowId) => {
      const provider = ROW_PROVIDERS[rowId]!;
      try {
        return { rowId, eligible: await provider.eligibility(ctx) };
      } catch (err) {
        ctx.logger.warn(`[home:eligibility] ${rowId} threw`, err);
        return { rowId, eligible: false };
      }
    }),
  );
  return new Set(results.filter((result) => result.eligible).map((result) => result.rowId));
}

function resolveHero(ctx: RowContext): Promise<LayoutHero | null> {
  return pickHero(ctx).catch((err) => {
    ctx.logger.warn("[home:hero] pickHero threw", err);
    return null;
  });
}

function buildRowStub(rowId: string, preview: RowPreview): HomeRowStub {
  const provider = ROW_PROVIDERS[rowId]!;
  const stub: HomeRowStub = {
    rowId,
    kind: provider.kind,
    titleKey: provider.titleKey,
    initialCursor: preview.initialCursor,
  };
  if (provider.eyebrowKey) stub.eyebrowKey = provider.eyebrowKey;
  return stub;
}

// fallow-ignore-next-line complexity
async function previewRow(ctx: RowContext, rowId: string): Promise<RowPreview> {
  const provider = ROW_PROVIDERS[rowId]!;
  let initialCursor: string | null;
  try {
    initialCursor = await provider.initialCursor(ctx);
  } catch (err) {
    ctx.logger.warn(`[home:preview] ${rowId} initialCursor threw, keeping stub`, err);
    return { rowId, initialCursor: null, include: true };
  }
  try {
    const page = await provider.fetchPage(ctx, initialCursor);
    return { rowId, initialCursor, include: page.items.length > 0 || page.partial };
  } catch (err) {
    if (isRowSoftFailure(err)) {
      const detail =
        err instanceof AllPluginsFailedError
          ? `errors=${JSON.stringify(err.errors)}`
          : err instanceof PluginCallError
            ? `code=${err.code} plugin=${err.pluginId}`
            : err instanceof Error
              ? err.name
              : "?";
      ctx.logger.warn(
        `[home:preview] ${rowId} fetchPage soft-failed, keeping stub (${detail})`,
        err,
      );
      return { rowId, initialCursor, include: true };
    }
    ctx.logger.warn(`[home:preview] ${rowId} fetchPage threw, dropping row`, err);
    return { rowId, initialCursor, include: false };
  }
}
